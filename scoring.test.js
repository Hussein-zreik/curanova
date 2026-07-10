/* Unit tests for the pure clinical scoring logic in scoring.js.
   Run with `node --test` (Node 18+, no dependencies). These pin every score
   band and every escalation threshold so a regression here fails CI before it
   can reach the live tool and change a clinical recommendation. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./scoring.js');

/* Build a minimal visit. Fields default to "not measured" (undefined) so each
   test only sets what its branch depends on. savedAt drives ordering. */
function visit(o = {}) {
  return {
    id: o.id || 'v' + Math.random().toString(36).slice(2),
    savedAt: o.savedAt || '2026-01-01T00:00:00.000Z',
    woundLabel: o.woundLabel, toolTitle: o.toolTitle,
    alerts: o.alerts || [],
    ...('area' in o ? { area: o.area } : {}),
    ...('reductionPct' in o ? { reductionPct: o.reductionPct } : {}),
    ...('prevPct' in o ? { prevPct: o.prevPct } : {}),
    ...('bwat' in o ? { bwat: o.bwat } : {}),
    ...('weeks' in o ? { weeks: o.weeks } : {}),
  };
}

test('CDS thresholds are the documented clinical constants', () => {
  assert.deepEqual(S.CDS, { areaWorsePct: 20, bwatRise: 3, bwatSevere: 45, bwatStalled: 31, healWeek: 4, healReductionPct: 50 });
});

test('areaBand — BWAT size item boundaries (1–5)', () => {
  assert.equal(S.areaBand(0), 1);
  assert.equal(S.areaBand(3.99), 1);
  assert.equal(S.areaBand(4), 2);
  assert.equal(S.areaBand(15.99), 2);
  assert.equal(S.areaBand(16), 3);
  assert.equal(S.areaBand(35.99), 3);
  assert.equal(S.areaBand(36), 4);
  assert.equal(S.areaBand(79.99), 4);
  assert.equal(S.areaBand(80), 5);
});

test('pushAreaBand — PUSH surface-area sub-score (0–10)', () => {
  assert.equal(S.pushAreaBand(0), 0);
  assert.equal(S.pushAreaBand(-1), 0);
  assert.equal(S.pushAreaBand(0.29), 1);
  assert.equal(S.pushAreaBand(0.3), 2);
  assert.equal(S.pushAreaBand(0.6), 2);
  assert.equal(S.pushAreaBand(0.7), 3);
  assert.equal(S.pushAreaBand(1.0), 3);
  assert.equal(S.pushAreaBand(1.1), 4);
  assert.equal(S.pushAreaBand(2.0), 4);
  assert.equal(S.pushAreaBand(3.0), 5);
  assert.equal(S.pushAreaBand(4.0), 6);
  assert.equal(S.pushAreaBand(8.0), 7);
  assert.equal(S.pushAreaBand(12.0), 8);
  assert.equal(S.pushAreaBand(24.0), 9);
  assert.equal(S.pushAreaBand(24.01), 10);
  assert.equal(S.pushAreaBand(100), 10);
});

test('bwatBand — BWAT total → healing band and chip', () => {
  assert.equal(S.bwatBand(13).tag, 'Healing');
  assert.equal(S.bwatBand(13).v, 'Resurfaced / regenerated');
  assert.equal(S.bwatBand(14).tag, 'Healing');
  assert.equal(S.bwatBand(20).v, 'Healing well');
  assert.equal(S.bwatBand(21).tag, 'Watch');
  assert.equal(S.bwatBand(30).v, 'Progressing');
  assert.equal(S.bwatBand(31).tag, 'Escalate');
  assert.equal(S.bwatBand(45).v, 'Stalled / deteriorating');
  assert.equal(S.bwatBand(46).v, 'Severe / degeneration');
  assert.equal(S.bwatBand(65).tag, 'Escalate');
});

test('pctTxt — signed percentage display', () => {
  assert.equal(S.pctTxt(12), '+12%');
  assert.equal(S.pctTxt(0), '0%');
  assert.equal(S.pctTxt(-30), '-30%');
});

test('daysBetween — whole days between dates', () => {
  assert.equal(S.daysBetween('2026-01-08', '2026-01-01'), 7);
  assert.equal(S.daysBetween('2026-01-01', '2026-01-08'), -7);
  assert.equal(S.daysBetween('2026-01-01', '2026-01-01'), 0);
});

test('groupWounds — groups visits by label, falls back to title then "Wound"', () => {
  const p = { visits: [
    visit({ woundLabel: 'L heel' }), visit({ woundLabel: 'L heel' }),
    visit({ toolTitle: 'Pressure Injury' }),
    visit({}),
  ] };
  const g = S.groupWounds(p);
  assert.equal(g['L heel'].length, 2);
  assert.equal(g['Pressure Injury'].length, 1);
  assert.equal(g['Wound'].length, 1);
});

/* assessWound — one test per clinical branch, in the same priority order the
   function evaluates them (healed → escalate → watch → baseline → healing). */
test('assessWound — Healed via near-zero area', () => {
  const a = S.assessWound([visit({ area: 0.1 })]);
  assert.equal(a.chip, 'Healed'); assert.equal(a.tone, 'good');
});

test('assessWound — Healed via BWAT at floor', () => {
  const a = S.assessWound([visit({ bwat: 13, area: 5 })]);
  assert.equal(a.chip, 'Healed');
});

test('assessWound — Escalate on a critical alert', () => {
  const a = S.assessWound([visit({ area: 5, alerts: [{ sev: 'crit', text: 'x' }] })]);
  assert.equal(a.chip, 'Escalate'); assert.equal(a.tone, 'crit');
});

test('assessWound — Escalate when area enlarging ≥ areaWorsePct vs last visit', () => {
  const a = S.assessWound([
    visit({ savedAt: '2026-01-01T00:00:00Z', area: 4 }),
    visit({ savedAt: '2026-01-08T00:00:00Z', area: 5, prevPct: 20 }),
  ]);
  assert.equal(a.chip, 'Escalate');
});

test('assessWound — Escalate on severe BWAT (> bwatSevere)', () => {
  const a = S.assessWound([visit({ area: 30, bwat: 46 })]);
  assert.equal(a.chip, 'Escalate');
});

test('assessWound — Escalate: failing to heal by healWeek', () => {
  const a = S.assessWound([
    visit({ savedAt: '2026-01-01T00:00:00Z', area: 10 }),
    visit({ savedAt: '2026-02-01T00:00:00Z', area: 8, reductionPct: 20, weeks: 4 }),
  ]);
  assert.equal(a.chip, 'Escalate');
});

test('assessWound — Watch on a warning alert', () => {
  const a = S.assessWound([visit({ area: 5, alerts: [{ sev: 'warn', text: 'x' }] })]);
  assert.equal(a.chip, 'Watch'); assert.equal(a.tone, 'warn');
});

test('assessWound — Watch on stalled BWAT (≥ bwatStalled, ≤ bwatSevere)', () => {
  const a = S.assessWound([visit({ area: 20, bwat: 31 })]);
  assert.equal(a.chip, 'Watch');
});

test('assessWound — Watch when reduction < 20% across ≥2 visits', () => {
  const a = S.assessWound([
    visit({ savedAt: '2026-01-01T00:00:00Z', area: 10 }),
    visit({ savedAt: '2026-01-08T00:00:00Z', area: 9, reductionPct: 10 }),
  ]);
  assert.equal(a.chip, 'Watch');
});

test('assessWound — Baseline (New) on a single measured visit', () => {
  const a = S.assessWound([visit({ area: 5 })]);
  assert.equal(a.chip, 'New'); assert.equal(a.tone, 'info');
});

test('assessWound — On track when reduction ≥ healReductionPct with weeks', () => {
  const a = S.assessWound([
    visit({ savedAt: '2026-01-01T00:00:00Z', area: 10 }),
    visit({ savedAt: '2026-01-22T00:00:00Z', area: 4, reductionPct: 60, weeks: 3 }),
  ]);
  assert.equal(a.chip, 'On track'); assert.equal(a.tone, 'good');
});

test('assessWound — Healing when below baseline but under the predictor', () => {
  const a = S.assessWound([
    visit({ savedAt: '2026-01-01T00:00:00Z', area: 10 }),
    visit({ savedAt: '2026-01-22T00:00:00Z', area: 7, reductionPct: 30 }),
  ]);
  assert.equal(a.chip, 'Healing'); assert.equal(a.tone, 'good');
});

test('assessWound — latest visit (by savedAt) drives the status, not input order', () => {
  const a = S.assessWound([
    visit({ savedAt: '2026-02-01T00:00:00Z', area: 5, alerts: [{ sev: 'crit', text: 'now' }] }),
    visit({ savedAt: '2026-01-01T00:00:00Z', area: 5 }),
  ]);
  assert.equal(a.chip, 'Escalate');
});

test('overallStatus — worst tone across multiple wounds wins', () => {
  const p = { visits: [
    visit({ woundLabel: 'A', area: 4, reductionPct: 60, weeks: 3, savedAt: '2026-01-22T00:00:00Z' }),
    visit({ woundLabel: 'A', area: 10, savedAt: '2026-01-01T00:00:00Z' }),
    visit({ woundLabel: 'B', area: 5, alerts: [{ sev: 'crit', text: 'x' }] }),
  ] };
  const st = S.overallStatus(p);
  assert.equal(st.tone, 'crit');
});
