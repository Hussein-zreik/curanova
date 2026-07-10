/* ============================================================================
   CuraNova — nursing-interventions recommendation engine (pure, guideline-based)

   recommendInterventions(ctx) turns a plain "clinical context" object (gathered
   from the active assessment by gatherClinicalContext() in index.html) into an
   ORDERED list of recommendation groups. Each group:
       { tone, title, basis, items:[string,…] }
   tone ∈ {crit, warn, info, good} drives colour; order = display priority
   (safety first → etiology core → wound bed → dressing → systemic → education).

   POINT-OF-CARE DECISION SUPPORT ONLY — shown to the nurse, never saved. It does
   not replace clinical judgement or a physician's orders. Wording is anchored to
   the guidelines the app already cites: IWGDF 2023 & IWGDF/IDSA (diabetic foot),
   ADA Standards of Care 2025, NPIAP/EPUAP/PPPIA 2019 (pressure injuries),
   CDC/NHSN (surgical site infection), and the CEAP framework / compression
   evidence (venous & arterial). Rule-based → runs offline, identical every time,
   and is unit-tested in interventions.test.js (CI-gated).

   Dual environment: defines a global in the browser (classic <script>) and
   exports for Node tests via the module guard at the bottom.
   ========================================================================== */

function recommendInterventions(ctx) {
  ctx = ctx || {};
  var groups = [];
  function push(tone, title, basis, items) {
    items = (items || []).filter(Boolean);
    if (items.length) groups.push({ tone: tone, title: title, basis: basis, items: items });
  }
  var t = ctx.tool;
  var ex = ctx.exAmount, exType = ctx.exType;
  var nec = ctx.necrotic || {};

  /* ---------- 1. SAFETY / ESCALATION (etiology-critical, shown first) ---------- */
  var safety = [];
  if (t === 'art') {
    safety.push('DO NOT apply compression therapy — this is an arterial ulcer; compression can worsen ischaemia and cause tissue loss.');
    if (ctx.art && ctx.art.abi != null && ctx.art.abi < 0.4)
      safety.push('ABI ' + ctx.art.abi + ' indicates critical limb ischaemia — arrange URGENT vascular / surgical referral today; limb is at risk.');
    else if (ctx.art && ctx.art.abi != null && ctx.art.abi < 0.5)
      safety.push('ABI ' + ctx.art.abi + ' indicates severe peripheral arterial disease — arrange prompt vascular referral.');
    if (ctx.art && ctx.art.gangrene)
      safety.push('Gangrene / tissue loss present — urgent vascular & surgical review; keep the area dry, do not debride ischaemic/dry eschar without a perfusion decision.');
    safety.push('Keep the limb dependent (avoid leg elevation), keep the foot warm and protected from pressure, cold and trauma.');
  }
  if (t === 'ven' && ctx.ven && ctx.ven.abpi != null) {
    var a = ctx.ven.abpi;
    if (a < 0.5) safety.push('ABPI ' + a + ' — do NOT compress; significant arterial disease. Urgent vascular referral before any compression.');
    else if (a < 0.8) safety.push('ABPI ' + a + ' — mixed arterial/venous disease: withhold full compression and obtain vascular review; only reduced/modified compression under specialist guidance.');
    else if (a > 1.3) safety.push('ABPI ' + a + ' — likely non-compressible (calcified) vessels: value unreliable, confirm perfusion (toe pressures) before applying compression.');
  }
  if (t === 'dfu') {
    if (ctx.dfu && ctx.dfu.idsa === 'Severe')
      safety.push('IWGDF/IDSA severe infection (systemic toxicity) — urgent referral / likely admission for IV antibiotics and source control; do not delay.');
    else if (ctx.dfu && ctx.dfu.idsa === 'Moderate')
      safety.push('IWGDF/IDSA moderate infection (deep/extensive) — arrange prompt medical review; consider imaging for osteomyelitis if bone is exposed or probes positive.');
    if (ctx.dfu && ((ctx.dfu.abi != null && ctx.dfu.abi < 0.5) || (ctx.dfu.wifiI != null && ctx.dfu.wifiI >= 2)))
      safety.push('Impaired perfusion suspected (WIfI ischaemia grade ≥ 2 / low ABI) — reassess before debridement and refer for vascular assessment; ischaemia limits healing and changes wound-bed management.');
  }
  if (t === 'surg') {
    if (ctx.surg && ctx.surg.ssiSigns >= 1)
      safety.push('Signs of surgical-site infection present — notify the referring surgeon; consider wound swab for culture and review antibiotic need per CDC/NHSN.');
    if (ctx.surg && ctx.surg.ssiClass === 'organ')
      safety.push('Organ/space involvement — urgent surgical review; this is a deep SSI requiring source control.');
    if (ctx.surg && ctx.surg.dehiscence)
      safety.push('Wound dehiscence — assess for evisceration (surgical emergency if viscera exposed: cover with sterile saline-soaked gauze and escalate immediately); otherwise notify the surgeon and manage as an open wound.');
  }
  if (t === 'pi') {
    if (ctx.pi && (ctx.pi.stage === 'Stage 4'))
      safety.push('Stage 4 pressure injury (exposed bone/muscle/tendon) — ensure specialist / tissue-viability involvement; assess for osteomyelitis and undermining/tunnelling.');
    if (ctx.pi && (ctx.pi.stage === 'Unstageable' || ctx.pi.stage === 'DTPI'))
      safety.push('Unstageable / deep-tissue injury — do not remove stable dry eschar on ischaemic heels; reassess frequently as the injury may evolve/declare over days.');
  }
  // cross-cutting deterioration
  if (ctx.prevPct != null && ctx.prevPct >= 20)
    safety.push('Wound enlarging (area up ' + ctx.prevPct + '% since last visit) — reassess aetiology, infection and perfusion; escalate to physician / supervisor.');
  if (ctx.weeks != null && ctx.weeks >= 4 && ctx.reductionPct != null && ctx.reductionPct < 50)
    safety.push('Failing to heal (' + ctx.reductionPct + '% reduction by week ' + ctx.weeks + ', target ≥ 50%) — reassess the whole plan and escalate; a wound not on a healing trajectory needs a diagnostic rethink.');
  push('crit', 'Safety & escalation', 'IWGDF 2023 · CDC/NHSN · NPIAP 2019', safety);

  /* ---------- 2. INFECTION / INFLAMMATION ---------- */
  var inf = [];
  var infected = (exType === 'purulent') || ctx.infection === 'spreading' || ctx.infection === 'local' ||
    (ctx.dfu && (ctx.dfu.idsa === 'Mild' || ctx.dfu.idsa === 'Moderate' || ctx.dfu.idsa === 'Severe')) ||
    (ctx.surg && ctx.surg.ssiSigns >= 1);
  if (infected) {
    inf.push('Cleanse the wound at each change (potable water or saline); consider a 2-week trial of a topical antimicrobial dressing (silver, iodine, PHMB or honey) for local infection, then review.');
    inf.push('Send a wound swab / tissue for culture if infection is spreading, systemic, or not improving — guide systemic antibiotics by culture, do not use topical antimicrobials indefinitely.');
    inf.push('Watch for and document spreading erythema, increasing pain, warmth, malodour, or systemic signs (fever, rising glucose) — escalate promptly if present.');
  } else if (ex === 'moderate' || ex === 'large' || ctx.bwatTag === 'Escalate' || ctx.bwatTag === 'Watch') {
    inf.push('No overt infection, but monitor for covert/biofilm signs (stalled healing, friable/hypergranulation tissue, increasing exudate) — cleanse and debride to disrupt biofilm at each visit.');
  }
  if (ctx.odour && /strong/i.test(ctx.odour))
    inf.push('Malodour present — after cleansing/debridement, consider a charcoal-containing or antimicrobial dressing; persistent odour suggests infection or necrotic burden needing review.');
  push('warn', 'Infection & inflammation control', 'IWGDF/IDSA · wound-hygiene (TIMERS)', inf);

  /* ---------- 3. ETIOLOGY CORE INTERVENTION ---------- */
  if (t === 'dfu') {
    push('warn', 'Offloading — first-line for diabetic foot', 'IWGDF 2023 (offloading)', [
      'Provide pressure offloading for a plantar ulcer — a non-removable knee-high offloading device (TCC or non-removable walker) is the gold standard; use a removable knee-high/ankle-high device or felted foam if not tolerated or if infection/ischaemia present.',
      'Reinforce strict non-weight-bearing on the ulcer and correct any device/footwear at every visit — adherence is the main determinant of healing.',
      'Address callus around plantar ulcers (sharp debridement of callus) and arrange appropriate therapeutic footwear/insoles to prevent recurrence once healed.'
    ]);
    push('good', 'Diabetes & systemic optimisation', 'ADA Standards of Care 2025', [
      'Coordinate glycaemic optimisation to an individualised target — hyperglycaemia impairs immune function and healing.',
      'Assess vascular status (pulses, ABI/toe pressures) and refer if perfusion is inadequate; screen and manage cardiovascular risk factors.',
      'Screen for peripheral neuropathy (10 g monofilament / protective sensation) and reinforce daily foot self-inspection and protection.'
    ]);
  }
  if (t === 'pi') {
    var bradenLow = ctx.pi && ctx.pi.braden != null && ctx.pi.braden <= 18;
    push('warn', 'Pressure redistribution & repositioning', 'NPIAP/EPUAP/PPPIA 2019', [
      'Reposition regularly using a documented schedule (typically ≥ every 2 h in bed, every 1 h in a chair, tailored to the individual and support surface); use the 30° tilt and avoid positioning directly on the injury.',
      (bradenLow ? 'Braden ' + ctx.pi.braden + '/23 (at risk) — provide a pressure-redistributing support surface (reactive/active mattress or cushion) matched to risk and mobility.' : 'Provide a pressure-redistributing support surface appropriate to risk, weight and mobility.'),
      'Offload the heels completely (float heels with a pillow under the calves or a heel-suspension device); protect bony prominences.',
      'Use safe manual-handling / slide sheets to avoid friction and shear; do NOT massage or vigorously rub reddened bony prominences.',
      'Encourage and assist mobility/activity as able; involve physiotherapy for seating and positioning.'
    ]);
    if (ctx.pi && ctx.pi.bradenSub) {
      var s = ctx.pi.bradenSub, sub = [];
      if (s.moist != null && s.moist <= 2) sub.push('Moisture (Braden subscale low) — manage incontinence/perspiration: check skin frequently, cleanse promptly, apply a barrier film/cream, consider absorbent products or a moisture-wicking surface.');
      if (s.nut != null && s.nut <= 2) sub.push('Nutrition subscale low — refer to dietitian; optimise protein, energy and hydration (see nutrition below).');
      if (s.fric != null && s.fric <= 2) sub.push('Friction/shear subscale low — use slide sheets, limit head-of-bed elevation to ≤ 30° where clinically safe, protect elbows/heels.');
      push('info', 'Act on individual Braden subscales', 'NPIAP/EPUAP/PPPIA 2019', sub);
    }
  }
  if (t === 'ven') {
    var canCompress = ctx.ven && ctx.ven.abpi != null && ctx.ven.abpi >= 0.8 && ctx.ven.abpi <= 1.3;
    push('warn', 'Compression & venous management', 'CEAP · venous-ulcer compression evidence', [
      (canCompress
        ? 'ABPI ' + ctx.ven.abpi + ' supports compression — apply strong graduated compression (multicomponent / short-stretch bandaging, ~40 mmHg at the ankle) by a trained clinician; this is the single most effective venous-ulcer intervention.'
        : 'Confirm ABPI 0.8–1.3 before applying full compression — if not documented/safe, withhold compression and obtain vascular assessment first.'),
      'Elevate the legs above heart level when resting to reduce venous hypertension and oedema.',
      'Encourage ankle exercises and walking to activate the calf-muscle pump; discourage prolonged standing/sitting with dependent legs.',
      'Manage periwound eczema/dermatitis and skin dryness with bland emollients; once healed, transition to lifelong graduated compression hosiery to prevent recurrence.'
    ]);
  }
  if (t === 'art') {
    push('warn', 'Perfusion-first arterial management', 'vascular / limb-preservation principles', [
      'Prioritise revascularisation assessment — healing is unlikely without adequate perfusion; coordinate vascular referral and imaging.',
      'Protect the limb: keep warm, avoid trauma/pressure (heel and toe protection), avoid tight dressings and adhesive skin stripping.',
      'Do NOT elevate the leg (unlike venous) and do NOT compress; a slightly dependent position may improve arterial inflow and rest pain.',
      'Support smoking cessation and cardiovascular risk management (antiplatelet, statin, BP, glucose) as directed by the physician.',
      'Manage ischaemic rest pain proactively and refer for pain control; keep dry stable eschar dry (do not moisten) pending a perfusion decision.'
    ]);
  }
  if (t === 'surg') {
    push('warn', 'Surgical incision / wound care', 'CDC/NHSN · SSI prevention', [
      'For a closed incision, keep the dressing intact and the site clean and dry for the first 24–48 h, then manage per surgeon; use aseptic non-touch technique for all dressing changes.',
      'For an open/dehisced surgical wound, manage as a healing-by-secondary-intention cavity: cleanse, lightly pack dead space if indicated, maintain a moist wound bed, and protect the periwound.',
      'Maintain glycaemic control, normothermia and nutrition — all reduce SSI risk and support incision healing.',
      'Reinforce incision-care education, hand hygiene, and the signs of SSI that should prompt an early review.'
    ]);
  }

  /* ---------- 4. WOUND-BED PREPARATION (TIME) ---------- */
  var bed = [];
  var ischaemicCaution = (t === 'art') ||
    (t === 'dfu' && ctx.dfu && ((ctx.dfu.abi != null && ctx.dfu.abi < 0.5) || (ctx.dfu.wifiI != null && ctx.dfu.wifiI >= 2))) ||
    (t === 'ven' && ctx.ven && ctx.ven.abpi != null && ctx.ven.abpi < 0.8);
  if (nec.eschar || nec.slough || nec.present) {
    if (ischaemicCaution)
      bed.push('Non-viable tissue present BUT perfusion is impaired — do NOT sharp/aggressively debride; keep dry stable eschar dry and obtain a vascular decision first. Consider only conservative/autolytic methods once perfusion is confirmed.');
    else {
      bed.push('Debride non-viable tissue (slough/eschar) to a clean granulating base — choose the method by wound and skill: sharp/surgical (fastest), or autolytic (hydrogel/hydrocolloid), enzymatic, or mechanical/biosurgical.');
      bed.push('Debridement is usually repeated ("maintenance debridement") at successive visits to control slough and biofilm.');
    }
  }
  if (ctx.granulationPoor && !ischaemicCaution)
    bed.push('Poor granulation — after debridement and infection control, optimise moisture balance; if the bed stays unhealthy despite a good plan, reassess for infection/biofilm, perfusion or an incorrect diagnosis and consider advanced therapies (NPWT, skin substitutes) on referral.');
  if (ctx.undermining)
    bed.push('Undermining / tunnelling recorded (' + ctx.undermining + ') — gently explore and lightly fill dead space with a conformable dressing to heal from the base up; never pack tightly; measure and track it.');
  if (ctx.depthCm != null && ctx.depthCm > 0)
    bed.push('Cavity depth ' + ctx.depthCm + ' cm — fill dead space to avoid premature surface closure/abscess; track depth at each visit.');
  push('warn', 'Wound-bed preparation', 'TIME / TIMERS framework', bed);

  /* ---------- 5. EXUDATE & DRESSING SELECTION ---------- */
  var dr = [];
  if (ex === 'large')
    dr.push('Heavy exudate — use a highly absorbent dressing (superabsorbent polymer or alginate/gelling fibre) and increase change frequency as needed; protect the periwound from maceration.');
  else if (ex === 'moderate')
    dr.push('Moderate exudate — a foam (± absorbent core) is usually appropriate; balance absorption against keeping the bed moist.');
  else if (ex === 'small' || ex === 'scant')
    dr.push('Low exudate — maintain a moist bed with a hydrocolloid, thin foam or hydrogel; avoid over-drying the wound.');
  else if (ex === 'none')
    dr.push('Dry wound bed — add/retain moisture with a hydrogel or a moisture-donating dressing (unless dry stable eschar on an ischaemic limb, which is kept dry).');
  if (exType === 'purulent' || infected)
    dr.push('For local infection, prefer an antimicrobial dressing (silver, iodine, PHMB, honey) for a defined 2-week trial, then reassess — avoid indefinite antimicrobial use.');
  dr.push('Match dressing wear-time to exudate and the dressing type; avoid unnecessary daily changes that disturb the wound bed, unless infection/strike-through requires it.');
  dr.push('Always protect the periwound skin with a barrier film/cream to prevent maceration and medical-adhesive skin injury.');
  push('info', 'Exudate management & dressing choice', 'exudate-management best practice', dr);

  /* ---------- 6. PERIWOUND & OEDEMA ---------- */
  var peri = [];
  if (ctx.periwoundIssue)
    peri.push('Periwound skin changes noted — protect with a barrier product, treat maceration (adjust absorbency/change frequency) and treat any dermatitis/eczema; avoid adhesive trauma.');
  if (ctx.edema)
    peri.push('Peripheral oedema present — treat the cause (venous → compression when ABPI-safe; systemic → medical review); elevate where appropriate (not in arterial disease).');
  if (ctx.induration)
    peri.push('Periwound induration — monitor for spreading infection/cellulitis; mark and reassess the margin.');
  push('info', 'Periwound skin & oedema', 'periwound-skin best practice', peri);

  /* ---------- 7. NUTRITION & SYSTEMIC SUPPORT ---------- */
  var nut = [];
  if (ctx.mstRisk)
    nut.push('Malnutrition risk screened positive (MST ≥ 2) — refer to a dietitian and optimise intake: adequate energy, protein ~1.25–1.5 g/kg/day, fluids, and consider vitamin C, zinc and arginine for stalled healing.');
  else
    nut.push('Support healing nutrition — ensure adequate protein, energy and hydration; rescreen nutrition if healing stalls or intake drops.');
  nut.push('Review medications and comorbidities that impair healing (steroids, poor glycaemic control, smoking) and coordinate optimisation with the physician.');
  push('good', 'Nutrition & systemic factors', 'nutrition-in-wound-healing guidance', nut);

  /* ---------- 8. PAIN ---------- */
  var pain = [];
  if (ctx.pain != null && ctx.pain >= 1) {
    pain.push('Wound/procedure pain reported (' + ctx.pain + '/10) — assess type and triggers; pre-medicate before dressing changes and time analgesia to the procedure.');
    pain.push('Use atraumatic, low-adherent (silicone) dressings, soak-off rather than pull, and minimise unnecessary changes to reduce pain and trauma.');
    if (ctx.pain >= 7) pain.push('Severe pain — escalate for a proper analgesia review; in arterial disease consider ischaemic rest pain requiring urgent vascular input.');
  }
  push('info', 'Pain management', 'atraumatic wound-care principles', pain);

  /* ---------- 9. PATIENT EDUCATION & SELF-CARE ---------- */
  var edu = [
    'Teach the patient/carer hand hygiene, how to keep the dressing intact/dry, and the warning signs to report early (increasing pain, redness, swelling, malodour, fever, dressing strike-through).',
    'Reinforce the specific self-care that drives this wound type — ' + (
      t === 'dfu' ? 'strict offloading/footwear and daily foot inspection.' :
        t === 'pi' ? 'repositioning, skin checks and keeping skin clean and dry.' :
          t === 'ven' ? 'wearing compression as prescribed, leg elevation and calf exercises.' :
            t === 'art' ? 'foot protection, warmth, smoking cessation and NOT using heat pads on a numb/ischaemic limb.' :
              'incision care, hand hygiene and not disturbing the wound.'),
    'Agree the care plan and follow-up with the patient; document education given and their understanding/adherence.'
  ];
  push('info', 'Patient education & self-care', 'shared-decision-making / self-management', edu);

  /* ---------- 10. MONITORING & REVIEW ---------- */
  var mon = [
    'Measure and document wound size (and photograph) at each visit to track the trajectory objectively.',
    'Expect roughly ≥ 40–50% area reduction by week 4 as a healing predictor — if not on track, re-evaluate diagnosis, infection, perfusion, offloading/compression and adherence, and escalate.',
    'Reassess vascular status periodically (ABI/ABPI) where relevant before continuing or starting compression.',
    'Set and communicate clear review/escalation triggers (deterioration, new infection signs, uncontrolled pain, no progress) to the patient and team.'
  ];
  if (ctx.trend === 'improving') mon.unshift('Wound is improving on current management — continue the plan, keep offloading/compression optimal, and avoid unnecessary changes.');
  if (ctx.trend === 'deteriorating') mon.unshift('Wound is deteriorating — treat this as a trigger to reassess the whole plan and escalate, not just change the dressing.');
  push('good', 'Monitoring & review', 'healing-trajectory (Sheehan/Margolis) predictor', mon);

  return groups;
}

/* Node-only export for tests; harmless (skipped) in the browser. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { recommendInterventions: recommendInterventions };
}
