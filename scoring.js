/* ============================================================================
   CuraNova — pure clinical scoring & assessment logic (single source of truth)

   This file is the ONE place the wound-scoring thresholds and the per-wound
   status/escalation logic live. It has NO DOM and NO app-state dependencies,
   so it runs identically in two places:
     • the browser, loaded as a classic <script> BEFORE index.html's app script
       (it defines the globals — CDS, assessWound, bwatBand, … — that the app
       already calls by name); and
     • Node, via `require('./scoring.js')` in scoring.test.js.

   Because a scoring change here can change a clinical recommendation, every
   threshold and branch is covered by scoring.test.js and gated in CI. Keep this
   file free of DOM/`document`/app globals so it stays testable.
   ========================================================================== */

/* Clinical-decision-support thresholds (shared by the app + the tests). */
const CDS = { areaWorsePct: 20, bwatRise: 3, bwatSevere: 45, bwatStalled: 31, healWeek: 4, healReductionPct: 50 };

/* Signed percentage for display, e.g. +12% / 0% / -30%. */
function pctTxt(p) { return (p > 0 ? '+' : '') + p + '%'; }

/* BWAT "Size (L×W)" item band 1–5 from wound area in cm². */
function areaBand(a) { return a < 4 ? 1 : a < 16 ? 2 : a < 36 ? 3 : a < 80 ? 4 : 5; }

/* PUSH "surface area" sub-score 0–10 from wound area in cm². */
function pushAreaBand(a) { if (a <= 0) return 0; if (a < 0.3) return 1; if (a < 0.7) return 2; if (a <= 1.0) return 3; if (a <= 2.0) return 4; if (a <= 3.0) return 5; if (a <= 4.0) return 6; if (a <= 8.0) return 7; if (a <= 12.0) return 8; if (a <= 24.0) return 9; return 10; }

/* Whole days between two dates (accepts ISO strings or Date). */
function daysBetween(a, b) { return Math.round((new Date(a) - new Date(b)) / 86400000); }

/* BWAT total (13–65) → healing band {v: description, c: colour var, tag: chip}. */
function bwatBand(t) {
  if (t <= 13) return { v: 'Resurfaced / regenerated', c: 'var(--ok)', tag: 'Healing' };
  if (t <= 20) return { v: 'Healing well', c: 'var(--low)', tag: 'Healing' };
  if (t <= 30) return { v: 'Progressing', c: 'var(--mild)', tag: 'Watch' };
  if (t <= 45) return { v: 'Stalled / deteriorating', c: 'var(--mod)', tag: 'Escalate' };
  return { v: 'Severe / degeneration', c: 'var(--severe)', tag: 'Escalate' };
}

/* Group a patient's visits into wounds, keyed by wound label (falls back to
   the tool title, then 'Wound'). */
function groupWounds(p) { const g = {}; (p.visits || []).forEach(v => { const k = v.woundLabel || v.toolTitle || 'Wound'; (g[k] = g[k] || []).push(v); }); return g; }

/* Synthesize a status for one wound from its visits (latest visit drives it).
   Returns {status, tone, chip, why}. tone ∈ {crit, warn, info, good}. */
function assessWound(vs) {
  const sorted = [...vs].sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt));
  const L = sorted[sorted.length - 1] || {}, n = sorted.length;
  const al = L.alerts || [], crit = al.filter(a => a.sev === 'crit').length, warn = al.filter(a => a.sev === 'warn').length;
  const area = typeof L.area === 'number' ? L.area : null, red = typeof L.reductionPct === 'number' ? L.reductionPct : null,
    prevPct = typeof L.prevPct === 'number' ? L.prevPct : null, bwat = typeof L.bwat === 'number' ? L.bwat : null,
    weeks = typeof L.weeks === 'number' ? L.weeks : null;
  let status, tone, chip, why;
  if ((area != null && area <= 0.1) || (bwat != null && bwat <= 13)) { status = 'Healed / resurfaced'; tone = 'good'; chip = 'Healed'; why = 'Wound closed — BWAT at floor / area ~0.'; }
  else if (crit > 0 || (prevPct != null && prevPct >= CDS.areaWorsePct) || (bwat != null && bwat > CDS.bwatSevere) || (weeks != null && weeks >= CDS.healWeek && red != null && red < CDS.healReductionPct)) {
    status = 'Deteriorating — escalate'; tone = 'crit'; chip = 'Escalate'; const b = [];
    if (prevPct != null && prevPct >= CDS.areaWorsePct) b.push(`area ↑${prevPct}% vs last visit`);
    if (weeks != null && weeks >= CDS.healWeek && red != null && red < CDS.healReductionPct) b.push(`${red}% reduction by wk ${weeks} (target ≥${CDS.healReductionPct}%)`);
    if (bwat != null && bwat > CDS.bwatSevere) b.push(`BWAT ${bwat}/65`);
    if (!b.length && crit) b.push(`${crit} critical alert${crit > 1 ? 's' : ''}`);
    why = b.join(' · ') + '.';
  }
  else if (warn > 0 || (bwat != null && bwat >= CDS.bwatStalled) || (n >= 2 && red != null && red < 20)) {
    status = 'Stalled — watch'; tone = 'warn'; chip = 'Watch'; const b = [];
    if (bwat != null && bwat >= CDS.bwatStalled) b.push(`BWAT ${bwat}/65 stalled`);
    if (n >= 2 && red != null) b.push(`${red}% below baseline`);
    if (!b.length && warn) b.push(`${warn} warning${warn > 1 ? 's' : ''}`);
    why = b.join(' · ') + '. Optimise dressing / offloading & reassess.';
  }
  else if (n < 2 || red == null) { status = 'Baseline recorded'; tone = 'info'; chip = 'New'; why = 'First measured visit — trend not yet established.'; }
  else { const onTrack = red >= CDS.healReductionPct; status = onTrack ? 'On track to heal' : 'Healing'; tone = 'good'; chip = onTrack ? 'On track' : 'Healing';
    why = onTrack && weeks != null ? `${red}% area reduction by wk ${weeks} — meets the ≥${CDS.healReductionPct}% predictor.` : `${red}% below baseline${bwat != null ? ` · BWAT ${bwat}/65` : ''}.`; }
  return { status, tone, chip, why };
}

/* Worst-tone wound across a patient (crit > warn > info > good). */
const TONE_RANK = { crit: 0, warn: 1, info: 2, good: 3 };
function overallStatus(p) { let best = null; Object.values(groupWounds(p)).forEach(vs => { const a = assessWound(vs); if (!best || TONE_RANK[a.tone] < TONE_RANK[best.tone]) best = a; }); return best; }

/* Node-only: expose the API for tests. In the browser `module` is undefined,
   so this is skipped and the definitions above remain available as globals. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CDS, TONE_RANK, pctTxt, areaBand, pushAreaBand, daysBetween, bwatBand, groupWounds, assessWound, overallStatus };
}
