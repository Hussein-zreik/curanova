/* Unit tests for the nursing-interventions engine (interventions.js).
   Run with `node --test`. These pin the safety-critical rules (compression
   contraindications, offloading, escalation) and the structural contract so a
   regression fails CI before it can reach nurses. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recommendInterventions } = require('./interventions.js');

// flatten all recommendation text for easy "contains" assertions
function allText(groups) { return groups.flatMap(g => g.items).join('\n').toLowerCase(); }
function titles(groups) { return groups.map(g => g.title); }
function group(groups, tone) { return groups.filter(g => g.tone === tone); }

test('returns tone/title/basis/items structure; every group non-empty', () => {
  const g = recommendInterventions({ tool: 'pi', area: 5, pi: { stage: 'Stage 2', braden: 14 } });
  assert.ok(Array.isArray(g) && g.length > 0);
  for (const grp of g) {
    assert.ok(['crit', 'warn', 'info', 'good'].includes(grp.tone), 'valid tone: ' + grp.tone);
    assert.equal(typeof grp.title, 'string');
    assert.ok(grp.items.length > 0, 'no empty groups');
  }
});

/* ---- Arterial: the hard safety rules ---- */
test('arterial — NEVER compress and do not elevate', () => {
  const txt = allText(recommendInterventions({ tool: 'art', area: 6, art: { abi: 0.6 } }));
  assert.match(txt, /do not apply compression|do not compress/);
  assert.match(txt, /do not elevate/);
});

test('arterial ABI < 0.4 → urgent vascular referral (critical limb ischaemia)', () => {
  const g = recommendInterventions({ tool: 'art', area: 6, art: { abi: 0.35 } });
  assert.match(allText(g), /critical limb ischaemia|urgent vascular/);
  assert.ok(group(g, 'crit').length >= 1, 'has a critical group');
});

test('arterial gangrene → urgent surgical/vascular review, keep dry', () => {
  const txt = allText(recommendInterventions({ tool: 'art', area: 6, art: { gangrene: true, abi: 0.5 } }));
  assert.match(txt, /gangrene/);
  assert.match(txt, /keep .* dry|do not moisten|keep dry/);
});

/* ---- Venous: compression is ABPI-gated ---- */
test('venous ABPI 0.9 → compression recommended', () => {
  const txt = allText(recommendInterventions({ tool: 'ven', area: 8, ven: { abpi: 0.9, ceap: 'C6' } }));
  assert.match(txt, /compression/);
  assert.match(txt, /graduated compression|multicomponent|short-stretch/);
});

test('venous ABPI 0.6 → withhold compression, vascular review', () => {
  const g = recommendInterventions({ tool: 'ven', area: 8, ven: { abpi: 0.6, ceap: 'C6' } });
  const txt = allText(g);
  assert.match(txt, /mixed arterial\/venous|withhold full compression|do not compress/);
  assert.ok(group(g, 'crit').length >= 1);
});

test('venous ABPI 1.4 → non-compressible vessels caution', () => {
  assert.match(allText(recommendInterventions({ tool: 'ven', area: 8, ven: { abpi: 1.4 } })), /non-compressible|calcified|unreliable/);
});

/* ---- Diabetic foot ---- */
test('DFU → offloading is first-line', () => {
  const g = recommendInterventions({ tool: 'dfu', area: 3, dfu: { sinbad: 3, idsa: 'Uninfected' } });
  assert.ok(titles(g).some(t => /offloading/i.test(t)), 'offloading group present');
  assert.match(allText(g), /non-removable|offloading device|total contact|weight-bearing/);
});

test('DFU severe infection → urgent referral / admission', () => {
  const g = recommendInterventions({ tool: 'dfu', area: 4, dfu: { idsa: 'Severe' } });
  assert.match(allText(g), /urgent referral|admission/);
  assert.ok(group(g, 'crit').length >= 1);
});

test('DFU WIfI ischaemia grade ≥2 → perfusion caution blocks aggressive debridement', () => {
  const txt = allText(recommendInterventions({ tool: 'dfu', area: 4, necrotic: { present: true, slough: true }, dfu: { wifiI: 3 } }));
  assert.match(txt, /perfusion|do not sharp|reassess before debridement|ischaemi/);
});

/* ---- Pressure injury ---- */
test('PI → repositioning + support surface; low Braden escalates surface', () => {
  const g = recommendInterventions({ tool: 'pi', area: 5, pi: { stage: 'Stage 3', braden: 12, bradenSub: { moist: 1, nut: 2, fric: 2 } } });
  const txt = allText(g);
  assert.match(txt, /reposition/);
  assert.match(txt, /support surface/);
  assert.match(txt, /float heels|heel/);
  assert.match(txt, /do not massage/);
  // acts on low subscales
  assert.match(txt, /moisture|barrier/);
});

test('PI Stage 4 → specialist involvement / osteomyelitis', () => {
  const g = recommendInterventions({ tool: 'pi', area: 10, pi: { stage: 'Stage 4', braden: 13 } });
  assert.ok(group(g, 'crit').length >= 1);
  assert.match(allText(g), /specialist|tissue-viability|osteomyelitis/);
});

/* ---- Surgical ---- */
test('surgical SSI signs → notify surgeon (CDC/NHSN)', () => {
  const g = recommendInterventions({ tool: 'surg', area: 3, surg: { ssiSigns: 3, ssiClass: 'deep' } });
  assert.match(allText(g), /surgical-site infection|notify the referring surgeon|culture/);
});

test('surgical dehiscence → evisceration safety note', () => {
  assert.match(allText(recommendInterventions({ tool: 'surg', area: 3, surg: { ssiSigns: 0, dehiscence: true } })), /evisceration|dehiscence/);
});

/* ---- Cross-cutting rules ---- */
test('enlarging wound (prevPct ≥ 20) → escalation', () => {
  assert.match(allText(recommendInterventions({ tool: 'pi', area: 6, prevPct: 25, pi: { stage: 'Stage 2' } })), /enlarging|escalate/);
});

test('failing to heal by week 4 (<50%) → reassess & escalate', () => {
  assert.match(allText(recommendInterventions({ tool: 'ven', area: 6, weeks: 4, reductionPct: 20, ven: { abpi: 0.9 } })), /failing to heal|reassess the whole plan|escalate/);
});

test('malnutrition risk (MST≥2) → dietitian + protein target', () => {
  assert.match(allText(recommendInterventions({ tool: 'pi', area: 5, mstRisk: true, pi: { stage: 'Stage 2' } })), /dietitian|protein/);
});

test('heavy exudate → superabsorbent/alginate dressing', () => {
  assert.match(allText(recommendInterventions({ tool: 'ven', area: 8, exAmount: 'large', ven: { abpi: 0.9 } })), /superabsorbent|alginate|highly absorbent/);
});

test('purulent exudate → antimicrobial + infection group present', () => {
  const g = recommendInterventions({ tool: 'surg', area: 3, exType: 'purulent', surg: { ssiSigns: 2 } });
  assert.match(allText(g), /antimicrobial|silver|iodine|phmb/);
});

test('undermining recorded → light fill, never pack tightly', () => {
  assert.match(allText(recommendInterventions({ tool: 'pi', area: 5, undermining: '2cm @ 3 o\'clock', pi: { stage: 'Stage 3' } })), /undermining|dead space|never pack/);
});

test('pain ≥7 → severe-pain escalation', () => {
  assert.match(allText(recommendInterventions({ tool: 'ven', area: 6, pain: 8, ven: { abpi: 0.9 } })), /severe pain|analgesia/);
});

test('education + monitoring always present; safety only when something must escalate', () => {
  // benign case: no safety triggers → no "Safety & escalation" box (by design)
  const benign = recommendInterventions({ tool: 'dfu', area: 4, dfu: { sinbad: 2, idsa: 'Uninfected' } });
  const bt = titles(benign).join(' | ');
  assert.match(bt, /Patient education/);
  assert.match(bt, /Monitoring & review/);
  assert.ok(!/Safety & escalation/.test(bt), 'no empty safety box when nothing to escalate');
  // case with a trigger → safety box appears
  const risky = recommendInterventions({ tool: 'dfu', area: 4, dfu: { idsa: 'Severe' } });
  assert.match(titles(risky).join(' | '), /Safety & escalation/);
});
