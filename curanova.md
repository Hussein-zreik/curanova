# CuraNova — Project Handoff

> Single-source context for continuing work in a fresh session. Read this first.
> Last updated: session of 2026-07-09 (WhatsApp physician summary). Earlier: wound-assessment tool, portal, deliverables, APK prep.

---

## 1. What CuraNova is
A **home-nursing advanced wound-care tool** for a small nursing team and their referring physicians. It is a **single-page web app** (one big `index.html`) that:
- Runs guideline-based wound assessments (Surgical, Diabetic Foot, Pressure Injury, Venous, Arterial) that auto-calculate validated scores (BWAT, SINBAD, Braden, CDC/NHSN class, NPIAP stage, CEAP, ABI/ABPI, PUSH, WIfI, MST).
- Saves each assessment to a **Patient Log** keyed by MRN (visits append; never duplicated).
- Surfaces CDS alerts, healing trajectory (area L×W, % change), and generates a **printable Patient Wound Record** for the referring physician.
- Is an installable **PWA**, works offline, and syncs across devices via a shared **Supabase** backend.
- Has a read-only **Physician Portal** scoped to each doctor's own patients, with sign-off notes.

---

## 2. Where it lives
- **Repo:** `hussein-zreik/curanova` (GitHub). Owner login casing: `Hussein-zreik`.
- **Live site (GitHub Pages, serves `main`):** https://hussein-zreik.github.io/curanova/
- **Working branch:** whichever `claude/...` branch the current session assigns (latest: `claude/curanova-md-session-i2y0ag`; earlier work on `claude/project-file-review-awswjy`). Deploy flow below applies regardless of the dev branch name.
- **Pages workflow id:** `306528249` (name: "pages build and deployment", path `dynamic/pages/pages-build-deployment`).

---

## 3. Deploy flow & the Pages gotcha
Established flow for anything that must go live:
1. Commit to `claude/project-file-review-awswjy`, push it.
2. Cherry-pick that commit onto `main` and push `main` (Pages serves `main`):
   ```
   FIX=$(git rev-parse HEAD)
   git push -u origin claude/project-file-review-awswjy
   git fetch origin main -q
   git checkout -q -B _m origin/main
   git cherry-pick "$FIX"
   git push origin _m:main       # retry with backoff on network errors
   git checkout -q claude/project-file-review-awswjy && git branch -q -D _m
   ```
3. Verify the Pages run for `main` reaches `conclusion: success`.

**Gotcha:** GitHub Pages intermittently fails the deploy step with *"Deployment failed, try again later."* The reliable fix is a **fresh clean push** to `main` and letting it deploy. **Do NOT use `rerun_failed_jobs`** on a stuck Pages run — it puts the run into an un-cancellable "re-run that has not yet queued" zombie state that holds the `github-pages` environment lock and blocks all new deploys. If zombies appear, just push a new commit and wait for the lock to time out.

Notes:
- `.nojekyll` is present at repo root so Pages serves the `.well-known/` dot-folder (needed for the Android app link) and static files verbatim.
- The app has **PWA auto-update** (service worker reloads on new version), so once a deploy lands, installed apps/browsers pick it up automatically. To see changes immediately: hard-refresh (Ctrl/Cmd+Shift+R) or incognito.
- `dl.google.com` is **blocked** from the build sandbox (so Android SDK can't be fetched here); `github.io` is also not reachable from the sandbox (can't curl the live site). Verify deploys via the GitHub Actions API, not by fetching the URL.

---

## 4. Architecture
- **`index.html`** is the app UI + most logic (~2900 lines: HTML + inline CSS + vanilla JS). No framework.
- **`scoring.js`** — pure clinical scoring/assessment logic, extracted as the **single source of truth** (session 2026-07-09). No DOM/app-state deps. Loaded as a classic `<script src="scoring.js">` **before** the inline app script (so it defines the globals `CDS`, `TONE_RANK`, `pctTxt`, `areaBand`, `pushAreaBand`, `daysBetween`, `bwatBand`, `groupWounds`, `assessWound`, `overallStatus` that index.html calls by name), and `require()`d by tests in Node (dual browser/CommonJS via a `typeof module` guard). **Add new score bands / CDS thresholds here, not inline.**
- **`interventions.js`** — pure nursing-interventions recommendation engine (session 2026-07-10). `recommendInterventions(ctx)` maps a plain findings object → ordered `{tone,title,basis,items[]}` groups (safety → etiology core → wound bed → dressing → periwound → nutrition → pain → education → monitoring). Guideline-anchored (IWGDF 2023, ADA 2025, NPIAP/EPUAP 2019, CDC/NHSN, CEAP). Same dual browser/Node pattern; loaded after scoring.js. **Edit clinical wording here.** In `index.html`: `gatherClinicalContext()` is the DOM adapter (reads BWAT/metrics + tool-specific findings), `renderInterventions()` renders into `#interventionsPanel` (placed last in each tool by `placeShared`), `clearInterventions()` wipes it. **Nurse-only, ephemeral:** never captured (captureTool skips the panel title), never saved, `@media print` hidden, cleared on tool-switch/reset/save. A lightweight `audit('interventions',…)` logs only that it was used (count), not the content.
- Both modules cached in `sw.js` CORE (bumped to `curanova-v6`).
- **Tests/CI:** `scoring.test.js` + `interventions.test.js` (Node built-in `node --test`, zero deps) pin score bands, escalation thresholds, and the safety-critical intervention rules (compression contraindications, offloading, escalation). `.github/workflows/test.yml` runs them on every push/PR; `package.json` has `"test":"node --test"`. Run locally: `node --test` (43 tests). **When you change a threshold or a safety rule, update its test.**
- **PWA:** `sw.js` (network-first navigation, stale-while-revalidate assets, never caches `*.supabase.co`, skipWaiting+clients.claim), `manifest.webmanifest`, `icon-192.png`, `icon-512.png`.
- **Local persistence (localStorage keys):** `curanova_patients`, `curanova_lists`, `curanova_queue` (offline write queue), `curanova_audit`, `curanova_signoffs`, `curanova_draft`, `curanova_errors` (crash ring buffer, max 50).
- **Crash safety net (session 2026-07-10):** a self-contained catch-all is the **first** script in `index.html` (before the SW registration) so it catches errors anywhere, including startup. `window` `error` + `unhandledrejection` listeners → (1) append to `curanova_errors` ring buffer, (2) best-effort `audit('error',…)` (syncs to cloud; throttled 3s per identical error to avoid flooding), (3) show a plain-language `#cn-errbar` banner (styled inline, does **not** depend on the app's `toast`). Manual hook `window.cnReport(err, where)` for critical paths. `saveToLog()` body is wrapped in try/catch: on crash it calls `cnReport` and toasts "Could not save … nothing was recorded" (explicit, so a lost assessment is never silent). To view captured errors: `JSON.parse(localStorage.curanova_errors)` on the device, or query the Supabase `audit` table for `action='error'`.
- **Supabase (managed Postgres + Auth + RLS + realtime):**
  - Project ref: `ejxjlifhnqkseavoqlwq` → `https://ejxjlifhnqkseavoqlwq.supabase.co`
  - Tables: `patients` (one jsonb `data` blob per `mrn`), `app_lists`, `audit`, `profiles` (marks physician accounts + scoping name), `signoffs`.
  - RLS: nurses/shared login have no `profiles` row → full access; physicians have `role='physician'` + `physician_name` → read-only, scoped to visits whose `physician` matches their name.
  - Config block is near the end of `index.html`: `window.CURANOVA_CLOUD = {url, anonKey, email:'team@curanova.app'}` then the supabase-js CDN script.
- **Key JS functions (grep these in `index.html`):**
  - Capture/save: `captureTool(toolKey)` (textarea items now tagged `long:true`), `saveToLog()`.
  - Log/detail: `renderLog()`, `openPatient(mrn)`, `visitHTML(v)`, `trajectoryHTML(p)`, `patientAssessmentLine(p)`, `groupWounds`, `assessWound`.
  - Delete: `deleteVisit(vid)` (confirm), `deletePatient(mrn)` (confirm; nurse-only).
  - Print: `printPatient()` (all), `printSelected()`, `printVisit(vid)`, `markOmit`/`clearPrintOmit`, `setVisitPicks`, `reportCover(p,md)`, `coverSummary(p)`; cleanup on `afterprint`.
  - Auth/roles: `cloudInit`, `onAuthed` (reads `profiles` → `userRole`/`physicianName`), `applyRole`, `updateCloudBadge`, `cloudSignOut`.
  - Password reset: `showResetView`, `showSigninView`, `openNewPw`, `sendReset`, `saveNewPassword` (+ `onAuthStateChange` PASSWORD_RECOVERY handling in `cloudInit`).
  - Merge/sync: `mergePatient`, `cloudPull`, `pushPatientMerged`, `flushQueue`, `queueOp`, `cloudUpsertPatient`, `cloudDeletePatient`.
  - WhatsApp physician summary: `waSummary(p,visit)` (plaintext WA-markdown message), `sendWA(mrn,vid)` (wa.me deep link; contact-picker fallback), `normPhone`/`getPhysPhone`/`setPhysPhone`/`promptPhysPhone` (directory), `showSendBanner`/`dismissSendBanner` (after-save prompt), `editPhysNumber` (detail-actions "Dr. number" button).

---

## 5. What we built/changed this session
**Branding**
- Replaced the logo with the user's uploaded mark (teal+blue interlocking bandage links). `logo-mark.png` is a **transparent-background cutout** trimmed from the high-res `logo.png`; `logo-tile.png` is the squared tile used in the app header/print; `icon-192/512.png` regenerated. Rule from user: *use the logo as-is, do not recreate it.*

**Deliverables produced (in repo root, HTML + some PDFs):**
- `CuraNova-Flyer.html` / `.pdf` — A4 physician-referral flyer, navy/teal theme, real logo, WhatsApp band (teal-themed icon), **empty QR placeholder**, scales as one unit on small screens.
- `CuraNova-Business-Card.html` — 3.5×2in, editable fields, QR to the live tool.
- `CuraNova-Supply-Checklist.html` — printable wound-care supply/equipment par-level checklist.
- `CuraNova-Add-Physician-Guide.html` / `.pdf` — step-by-step "give a doctor access" (incl. a copy-paste SQL block, one query per doctor).
- (Earlier) `physician-cheatsheet.html`, `SUPABASE_SETUP.md`, `physician-portal-setup.sql`.

**Physician portal**
- RLS/portal SQL in `physician-portal-setup.sql`. Common failure: a login **sees everything** because it has **no `profiles` row** → treated as full-access clinician. Fix = insert a `profiles` row (`role='physician'`, `physician_name` matching how nurses type "Referring physician"), then sign out/in. Diagnostic:
  ```sql
  select u.email, p.role, p.physician_name
  from auth.users u left join profiles p on p.id = u.id;
  ```
- The add-physician insert (one per doctor, new query each time):
  ```sql
  insert into profiles (id, role, physician_name, full_name)
  select id, 'physician', 'Haddad', 'Dr. Elie Haddad'
  from auth.users where email = 'doctor@email.com'
  on conflict (id) do update set role=excluded.role,
    physician_name=excluded.physician_name, full_name=excluded.full_name;
  ```

**App changes**
- **Top-of-screen Sign out** in the header (all layouts, all roles when signed in); removed the buried log-toolbar / portal-banner copies.
- **Physician password reset** (self-service): lock screen has "Physician? Reset your password"; `resetPasswordForEmail` → email link → "Set a new password" screen (`updateUser`). Shared `team@curanova.app` is blocked from resetting (physician-only).
- **Assessment-tool modifications (latest):**
  - Login screen redesigned (elevated single card: teal accent bar, larger logo, tagline, refined inputs/footer, glowing navy backdrop).
  - Patient log: discoverable **per-visit delete** (trash icon on each visit header) + **whole-record delete** (`deletePatient`, Yes/No confirm). Nurse-only; hidden for physicians and in print.
  - Printed report: **professional cover page** (brand, patient identity grid, report date, clinical summary, signature line) replacing the old near-empty first page; content now flows from page 1 (overrode the single-`.panel` `break-inside:avoid`). **Clinical notes print full-width with line breaks preserved** (`white-space:pre-wrap`), not a cramped half-column.
  - Printing: per-visit **"Print this visit"**, include **checkboxes** + **All/None** + **"Print selected"** (unselected visits and the trend table are omitted); **"Print all"** unchanged.

**WhatsApp physician summary (session 2026-07-09)**
- After a nurse saves an assessment with a referring physician set, a green banner offers **"Send summary via WhatsApp"**; the patient log also has a per-visit WhatsApp icon (next to print) and a **"Dr. number"** button in the detail action bar. All nurse-only (`canEdit`), `no-print-log`.
- The message (`waSummary`) is WhatsApp-formatted plaintext: patient full name + MRN (user's explicit choice), wound/visit line, headline score + interpretation, size L×W×D + area + Δ vs last visit, whole-wound trend (baseline → latest, ⬇% , `assessWound` status), crit/warn alerts, next visit + nurse, portal link.
- Delivery = `https://wa.me/<number>?text=<encoded>` (nurse reviews in WhatsApp and presses send); if no stored number and the prompt is cancelled, falls back to `https://api.whatsapp.com/send?text=` (WhatsApp contact picker). No backend/Business API by design.
- Physician numbers live in `curanova_lists.physicianPhones` (map: lowercased name → intl digits), syncs via the existing `app_lists` flow. `cloudPull`'s list-union was made object-safe (arrays union; maps merge, local wins). First send prompts once for the number, then remembers.
- Verified end-to-end with Playwright (37 checks: message content, URL building, number persistence, role gating, banner flow, list regressions).

**Nursing interventions recommendations (session 2026-07-10)**
- New nurse-facing panel on all 5 assessment tools: after the alerts, a **"Get nursing interventions"** button generates comprehensive, prioritised, guideline-cited nursing interventions from the scores/findings already entered. Flow: identify → assess → alerts → **submit** → recommendations → save.
- **Rule-based** (engine in `interventions.js`, see §4), so it's instant, offline, deterministic and unit-tested. Content spans safety/escalation, etiology core (DFU offloading, PI repositioning/support surface, venous ABPI-gated compression, arterial no-compression, surgical incision/SSI care), wound-bed prep, dressing-by-exudate, periwound, nutrition, pain, education, monitoring. Standing disclaimer: decision support, not a substitute for clinical judgement/physician orders.
- **Not saved** (user's explicit choice): ephemeral guidance for the nurse only — not in the log, print, or portal. Content authored by Claude from the cited guidelines; user reviews live and will flag any wording to change.

**Android APK (prepared, not yet built)**
- Can't compile here (`dl.google.com` blocked). Plan: build with **PWABuilder** (server-side) from the live URL.
- Already done on our side: generated signing keystore `curanova-signing.keystore` (sent to user), published `.well-known/assetlinks.json` with its SHA-256 fingerprint for package `app.curanova.twa`, added `.nojekyll`.
- User's remaining steps: pwabuilder.com → enter live URL → Android → Package ID **`app.curanova.twa`** → signing "Use mine" (upload keystore, alias `curanova`, both passwords `CuraNova2026`) → download `app-release-signed.apk` → share with team.

---

## 6. Repo file inventory (root)
- `index.html` — the app.
- `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png` — PWA.
- `logo.png` (hi-res original), `logo-tile.png` (app/print tile), `logo-mark.png` (transparent cutout).
- `.well-known/assetlinks.json`, `.nojekyll` — Android TWA domain verification + Pages static serving.
- `CuraNova-Flyer.html`/`.pdf`, `CuraNova-Business-Card.html`, `CuraNova-Supply-Checklist.html`, `CuraNova-Add-Physician-Guide.html`/`.pdf`, `physician-cheatsheet.html` — deliverables.
- `physician-portal-setup.sql`, `SUPABASE_SETUP.md`, `README.md`.
- `curanova.md` — this handoff.
- Signing keystore `curanova-signing.keystore` lives OUTSIDE the repo (in `/home/user/`), delivered to the user; **do not commit it**.

---

## 7. Open items the user still owns (config the app can't do itself)
1. **Password-reset redirect URL** — Supabase → Authentication → URL Configuration → set **Site URL** and add **Redirect URL** = `https://hussein-zreik.github.io/curanova/`. Reset links won't return to the app without this.
2. **Real email (SMTP)** — Supabase's built-in sender is rate-limited and lands in **spam**. Connect Brevo (or similar) under Authentication → SMTP Settings; ideally authenticate the `curanova.app` domain (DNS records) so reset emails hit the inbox.
3. **Build the APK** — run PWABuilder (see §5). Keep `curanova-signing.keystore` safe (needed to update the app later with the same identity).
4. **Optional custom domain** — point `curanova.app` (their email domain) at GitHub Pages so the printed website/QR match; would also improve email deliverability.

---

## 8. Key facts / pointers
- Supabase project ref: `ejxjlifhnqkseavoqlwq`. Only the **anon** key is embedded in `index.html` (public by design). The **service_role** key must NEVER be committed/embedded (user pasted it once early on — recommend rotating it if not already).
- Shared team login: `team@curanova.app`. Physician test account: `zreik111@gmail.com`.
- WhatsApp contact on marketing pieces: **+961 79 093 599** (`wa.me/96179093599`).
- Android package id: `app.curanova.twa`; keystore alias `curanova`, store/key password `CuraNova2026`, SHA-256 in `.well-known/assetlinks.json`.
- Brand colors: navy `#0B2A43`, teal `#0D9488` / `#14B8A6`. WhatsApp accents in-app: `#25D366`.
- Physician WhatsApp directory: `curanova_lists.physicianPhones` (name lowercased → digits, e.g. `"haddad" → "96179093599"`); editable via the "Dr. number" button on a patient record.

---

## 9. Conventions
- **Do NOT** put the model identifier in commit messages, PR titles/bodies, code comments, or any pushed artifact.
- Be frugal with outward-facing actions; the flyer/card/checklist are on the public Pages site (user approved "merge all").
- Physician portal must stay read-only: gate edit/delete UI on `userRole!=='physician'` and mark controls `no-print-log`.
- When adding print output, remember the two-path print system: assessment-form print (`.print-head`) vs. patient-record print (`.report-cover`, shown only when `body.viewing-record`).
