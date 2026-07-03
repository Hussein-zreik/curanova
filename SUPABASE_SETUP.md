# CuraNova — Shared Cloud Sync Setup (Supabase)

By default the app stores records only in the browser. Follow these steps once
to turn on **shared, cross-device sync** so partners see the same patient logs.
It takes ~5 minutes and is free.

Security model: data is protected by **one shared login** (Supabase Auth). The
password for that login *is* your team's **access code**. Anyone opening the
site must enter it before any patient data loads — and the database rejects
requests that aren't signed in, so the data is protected at the API level, not
just the screen.

---

## 1. Create a Supabase project
1. Go to <https://supabase.com> → sign up / log in → **New project**.
2. Name it (e.g. `curanova`), set a strong **database password** (you won't need
   it in the app), pick a region near you, and create it.

## 2. Create the tables + security rules
Open **SQL Editor** → **New query**, paste this, and click **Run**:

```sql
-- one row per wound-care patient (keyed by MRN)
create table if not exists patients (
  mrn        text primary key,
  name       text,
  dob        text,
  data       jsonb not null,
  updated_at timestamptz default now()
);

-- shared pick-lists (nurses, physicians, procedures, sites) — single row
create table if not exists app_lists (
  id   int primary key default 1,
  data jsonb
);

-- lock both tables down: only a signed-in (shared-login) user may read/write
alter table patients  enable row level security;
alter table app_lists enable row level security;

create policy "team read/write patients" on patients
  for all to authenticated using (true) with check (true);
create policy "team read/write lists" on app_lists
  for all to authenticated using (true) with check (true);

-- enable real-time so partners see each other's saves live
alter publication supabase_realtime add table patients;
```

## 3. Create the shared login (this password = your access code)
1. Go to **Authentication → Users → Add user → Create new user**.
2. **Email:** use the same one you'll put in the config below
   (e.g. `team@curanova.app` — it doesn't need to be a real inbox).
3. **Password:** choose the **access code** you'll give your partners.
4. ✅ Tick **Auto Confirm User** (so no email confirmation is needed).
5. (Recommended) **Authentication → Providers → Email:** turn **off**
   "Allow new users to sign up" so only this account can exist.

To change the access code later: edit this user's password here, or add more
users (each password works as a valid code).

## 4. Get your keys
**Project Settings → API**, copy:
- **Project URL** (e.g. `https://abcd1234.supabase.co`)
- **anon public** key (safe to expose — it's public by design; security is the
  login + rules above)

## 5. Paste the keys into the app
In `index.html`, find the `window.CURANOVA_CLOUD` block (near the bottom) and
fill it in:

```js
window.CURANOVA_CLOUD = {
  url:     'https://abcd1234.supabase.co',   // your Project URL
  anonKey: 'eyJhbGciOi...',                  // your anon public key
  email:   'team@curanova.app'               // the shared login email from step 3
};
```

Commit and push. Once GitHub Pages redeploys, opening the site shows the
**access-code screen**; enter the password from step 3 and the shared log loads.
Partners do the same on their own devices.

---

## Notes
- **First load replaces local data with the cloud copy.** If you had test
  records only in your browser before enabling sync, they won't upload — the
  cloud is the source of truth. Start fresh, or re-enter anything you want kept.
- **Photos** are stored inside each patient row as compressed images. That's
  fine for typical volumes; if you accumulate very large photo libraries per
  patient, we'd move images to Supabase Storage — tell me if/when that happens.
- **Offline:** if a device loses connection, saves stay on that device and a
  "not yet synced" note appears; reconnect and save again to push them up.
- **This is patient health information.** Keep the access code private, share it
  only with authorized partners, and rotate it if it leaks. For formal
  HIPAA/GDPR compliance you'd want a signed BAA with your host and stricter
  per-user access — revisit before handling real patients at scale.
