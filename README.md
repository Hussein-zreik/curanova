# CuraNova — Wound Assessment Tool

A single-file, offline-capable web app for home-nursing wound assessment and
longitudinal patient tracking. Open `index.html` in any modern browser — no
server, build step, or install required.

## Modules

| Tab | Purpose | Scoring |
|-----|---------|---------|
| **Surgical Wound** | CDC/NHSN classification, MEASURE wound bed, SSI surveillance | Wound class + SSI flag |
| **Diabetic Foot** | SINBAD, IWGDF/IDSA infection, 10-g monofilament foot map | SINBAD 0–6 |
| **Pressure Injury** | NPIAP/EPUAP 2019 staging, MEASURE, Braden Scale | Braden 6–23 |
| **Patient Log** | Saved records, search, per-patient printable history | — |

## Selectable / remembered content

Free-text fields have been replaced with pick-lists to keep documentation
consistent:

- **Attending nurse** and **Referring physician** — typeahead + `＋` to save a
  new name to the list.
- **Specialty** — dropdown of common referral specialties.
- **Procedure / operation** and **Incision site** — typeahead + `＋` to add.
- **Laterality** — Right / Left / Bilateral / Midline / Not applicable.

Saved list values persist in the browser and appear on every future visit.

## Patient Log & MRN memory

- Each assessment is saved (dock → **Save to Log**) under the patient's **MRN**,
  which acts as the unique patient key (Epic-style).
- Saving an assessment whose **MRN already exists appends the visit to that
  patient's record** — it never creates a duplicate.
- The Log tab has a **search bar** that matches on **MRN, name, or date of
  birth**.
- Opening a patient shows every logged visit with its score and structured
  fields, and a **Print / Save PDF** button for the full record.

## Wound photography

Each assessment page has a photo panel — capture from a device camera or upload
files. Images are downscaled client-side and stored with that visit.

## Data & privacy

All data (patient records, photos, remembered lists) is stored **only in the
current browser** via `localStorage`. Nothing is transmitted to any server.
Clearing browser data or using a different device/browser starts fresh.

## Evidence base

IWGDF 2023 · IWGDF/IDSA · ADA Standards of Care 2025 · NPIAP/EPUAP 2019 ·
CDC/NHSN · Braden Scale · MEASURE/TIME. A clinical aid — it supports triage and
physician communication and does not replace clinical judgement or diagnosis.
