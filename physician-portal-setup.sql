-- =====================================================================
--  CuraNova — Physician Portal setup
--  Run this ONCE in Supabase (SQL Editor → New query → paste → Run).
--  Safe to run again; it won't harm existing data or nurse logins.
-- =====================================================================

-- 1) A small table that marks which accounts are physicians.
create table if not exists profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  role           text not null default 'physician',
  physician_name text,
  full_name      text
);
alter table profiles enable row level security;
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles
  for select to authenticated using (id = auth.uid());

-- 2) Make physician logins READ-ONLY and limited to their own patients.
--    Nurses / the shared login are unaffected (they have no profile row).
drop policy if exists "team read/write patients" on patients;
drop policy if exists "team rw patients"        on patients;

create policy "clinicians full patients" on patients for all to authenticated
  using      ( not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'physician') )
  with check ( not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'physician') );

create policy "physician read scoped" on patients for select to authenticated
  using ( exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role = 'physician'
      and exists (
        select 1 from jsonb_array_elements(patients.data->'visits') v
        where lower(v->>'physician') like '%' || lower(p.physician_name) || '%'
      )
  ) );

-- 3) A table for physician sign-offs (their notes/directions).
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

-- =====================================================================
--  DONE. Now, to add ONE doctor:
--   Step A — Supabase → Authentication → Users → Add user → Create new user
--            (their email + a password  ← that password is their "code",
--             tick "Auto Confirm User").
--   Step B — run the small query below (change the 3 values), ONE per doctor:
--
--     insert into profiles (id, role, physician_name, full_name)
--     select id, 'physician', 'Haddad', 'Dr. Elie Haddad'
--     from auth.users where email = 'doctor-email@example.com';
--
--   ('Haddad' must match how your nurses type the "Referring physician".)
--   Then give the doctor: the website link + their email + password.
-- =====================================================================
