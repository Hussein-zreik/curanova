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
| **Patient Log** | Saved records, search, per-wound healing trajectory, printable history | — |

Every assessment also carries a shared **Measurements & BWAT** panel and an
automated **Clinical Alerts** engine (see below).

## Healing metrics & BWAT (from the workbook)

- **Wound area** auto-calculates from Length × Width (cm²).
- **BWAT (Bates-Jensen)** — all 13 items scored 1 (best) → 5 (worst), total
  13–65, with the workbook's status continuum (healing → stalled → severe).
- A **Wound ID / label** field groups a wound's visits so trends stay per-wound
  (a patient can have several wounds under one MRN).
- On save the tool computes **% area reduction from baseline**, **change vs. the
  previous visit**, and **weeks since baseline**, and draws a **healing
  trajectory** (sparkline + table) per wound in the Patient Log.

## Clinical Alerts — automated wound algorithms

A decision-support engine evaluates each visit live and on save, and flags the
nurse without them having to notice manually. Default rules:

| Trigger | Alert |
|---|---|
| Wound area ↑ ≥ 20% vs. last visit | **Critical** — enlarging, notify physician |
| < 50% area reduction by **week 4** (Sheehan/Margolis) | **Critical** — failing to heal, escalate |
| BWAT total > 45 | **Critical** — severe / degeneration |
| BWAT ↑ ≥ 3 points vs. last visit | **Warning** — worsening |
| BWAT 31–45 | **Warning** — stalled |
| Suspected SSI · IDSA severe/moderate · SINBAD ≥ 4 · Braden ≤ 12 · Stage 4 | Escalation flags |

Thresholds live in the `CDS` object in the script and can be tuned. Critical
flags raise a banner on save and are stamped onto the visit in the log. (Actual
supervisor *notification* would require a backend — see below.)

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
