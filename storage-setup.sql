-- ============================================================================
-- CuraNova — Wound Photo Storage setup (run ONCE in Supabase → SQL Editor)
--
-- Creates a PRIVATE Storage bucket for wound photos and row-level rules so:
--   • the nursing team / shared login (no `profiles` row) has full access, and
--   • a physician can READ only photos that belong to THEIR patients
--     (same scoping model as the patient records / portal).
--
-- Photos are stored at path:  <MRN>/<visitId>/<index>.jpg
-- The app never exposes them directly — it mints short-lived SIGNED URLs, and
-- these policies decide who is allowed to sign/read a given object.
--
-- Until this is applied, the app simply keeps photos inline (its old behaviour),
-- so nothing breaks; new photos start going to Storage once this runs.
-- ============================================================================

-- 1) The private bucket (public = false → no anonymous access; signed URLs only)
insert into storage.buckets (id, name, public)
values ('wound-photos', 'wound-photos', false)
on conflict (id) do nothing;

-- RLS is already enabled on storage.objects by Supabase. Drop old copies so this
-- script is safe to re-run.
drop policy if exists "curanova team full access wound photos" on storage.objects;
drop policy if exists "curanova physician read own patients wound photos" on storage.objects;

-- 2) Team / shared login (authenticated user with NO profiles row) — full access.
create policy "curanova team full access wound photos"
on storage.objects for all to authenticated
using (
  bucket_id = 'wound-photos'
  and not exists (select 1 from public.profiles p where p.id = auth.uid())
)
with check (
  bucket_id = 'wound-photos'
  and not exists (select 1 from public.profiles p where p.id = auth.uid())
);

-- 3) Physician — READ ONLY, and only for their own patients' photos.
--    Matches the MRN in the object path to a patient whose record contains a
--    visit with physician = the physician's scoping name (same brittle-but-
--    consistent match the app already uses for the portal). Read-only: no
--    insert/update/delete policy is granted to physicians.
create policy "curanova physician read own patients wound photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'wound-photos'
  and exists (
    select 1
    from public.profiles pr
    join public.patients pt
      on pt.mrn = split_part(storage.objects.name, '/', 1)
    where pr.id = auth.uid()
      and pr.role = 'physician'
      and pt.data::text ilike '%"physician":"' || pr.physician_name || '"%'
  )
);

-- Done. Verify in Supabase → Storage that the 'wound-photos' bucket exists and is
-- Private, and under Storage → Policies that the two policies above are listed.
