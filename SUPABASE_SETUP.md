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

-- shared audit trail (who did what, when) — optional but recommended
create table if not exists audit (
  id     bigint generated always as identity primary key,
  ts     timestamptz default now(),
  actor  text, action text, detail text
);
alter table audit enable row level security;
drop policy if exists "team rw audit" on audit;
create policy "team rw audit" on audit for all to authenticated using (true) with check (true);

-- enable real-time so partners see each other's saves live
alter publication supabase_realtime add table patients;
```

> Already ran the earlier SQL? Just run this whole block again — it's safe
> (idempotent), and it adds the new **audit** table used by the audit log.

### Per-partner logins (optional)
The lock screen has an **email** field (pre-filled with the shared email). To give
a partner their **own** login instead of the shared code, add another user in
**Authentication → Users** with their email + password; they enter those two on
the lock screen. The audit log then attributes actions to each person.

## Physician Portal (read-only, scoped access)

Referring physicians can log in and see **only their own** patients, read-only.
This is enforced at the database level with row-level security — a physician
cannot query another physician's patients even with the API keys.

### 1. Run this SQL (SQL Editor → New query → Run)

```sql
-- who is who: a profiles row exists only for physician (or admin) accounts.
-- Nurses/shared logins need NO profile row — they keep full access.
create table if not exists profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  role           text not null default 'physician',   -- 'physician' | 'nurse' | 'admin'
  physician_name text,                                 -- must appear in the "Referring physician" field
  full_name      text
);
alter table profiles enable row level security;
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select to authenticated using (id = auth.uid());

-- replace the open patients policy with role-scoped policies
drop policy if exists "team read/write patients" on patients;
drop policy if exists "team rw patients"        on patients;

-- clinicians (no profile, or role nurse/admin) get full read/write
create policy "clinicians full patients" on patients for all to authenticated
  using ( not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'physician') )
  with check ( not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'physician') );

-- physicians get read-only access to patients where they are a referring physician
create policy "physician read scoped" on patients for select to authenticated
  using ( exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role = 'physician'
      and exists (
        select 1 from jsonb_array_elements(patients.data->'visits') v
        where lower(v->>'physician') like '%' || lower(p.physician_name) || '%'
      )
  ) );
```

> Safe to re-run. This keeps every existing nurse/shared login working with full
> access (they have no `profiles` row) and only restricts accounts you mark as
> physicians.

### 2. Create a physician account
1. **Authentication → Users → Add user → Create new user** — the doctor's email +
   a password, ✅ **Auto Confirm User**. Copy the new user's **UID**.
2. **SQL Editor**, insert their profile (match `physician_name` to how nurses type
   the referring physician — a partial match works):

```sql
insert into profiles (id, role, physician_name, full_name)
values ('PASTE-USER-UID', 'physician', 'Haddad', 'Dr. Elie Haddad');
```

### 3. How it works
The doctor opens the same link, enters their **email + password**. The app detects
the physician role, hides the assessment tabs, and shows a **read-only Patient Log
scoped to their patients** — trajectories, photos, alerts, and a Print/Save-PDF.
Nurses are unaffected. To change what a doctor sees, edit their `physician_name`.

## Physician sign-off (append-only oversight record)

Physicians can add a timestamped **sign-off** (direction + note) on a patient from
the portal; nurses see it on the patient record. Sign-offs live in their own
append-only table, so physicians never get write access to clinical data.

Run this SQL:

```sql
create table if not exists signoffs (
  id        text primary key,
  mrn       text,
  by_email  text,
  by_name   text,
  ts        timestamptz default now(),
  direction text,
  note      text
);
alter table signoffs enable row level security;
drop policy if exists "read signoffs"   on signoffs;
drop policy if exists "insert signoffs" on signoffs;
create policy "read signoffs"   on signoffs for select to authenticated using (true);
create policy "insert signoffs"  on signoffs for insert to authenticated with check (true);
```

That's all — physicians can now sign off from their portal, and their direction is
recorded against the patient (visible to the nursing team and on the printout).

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
