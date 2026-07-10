/* Unit tests for the schema-migration layer (migrations.js).
   Run with `node --test`. These pin the invariants a migrated record must
   satisfy and the two things that must never happen: losing existing data, or
   throwing on garbage input. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SCHEMA_VERSION, migratePatient, migrateAll } = require('./migrations.js');

test('stamps the current schema version', () => {
  const p = migratePatient({ mrn: '1', visits: [] });
  assert.equal(p.schemaVersion, SCHEMA_VERSION);
});

test('is idempotent — re-running changes nothing and adds no versions', () => {
  const once = migratePatient({ mrn: '1', name: 'A', visits: [{ id: 'v1', savedAt: '2026-01-01', images: [], alerts: [], sections: [] }] });
  const twice = migratePatient(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test('fast path — an already-current record is returned untouched', () => {
  const cur = { mrn: '1', name: 'A', visits: [], schemaVersion: SCHEMA_VERSION };
  const out = migratePatient(cur);
  assert.equal(out, cur);            // same reference, no work done
});

test('fills a missing visits array', () => {
  const p = migratePatient({ mrn: '1' });
  assert.deepEqual(p.visits, []);
  assert.equal(p.schemaVersion, 1);
});

test('fills missing per-visit arrays (images/alerts/sections) and ids', () => {
  const p = migratePatient({ mrn: '1', visits: [{ toolTitle: 'DFU' }] });
  const v = p.visits[0];
  assert.ok(Array.isArray(v.images) && v.images.length === 0);
  assert.ok(Array.isArray(v.alerts));
  assert.ok(Array.isArray(v.sections));
  assert.equal(typeof v.id, 'string');
  assert.equal(typeof v.savedAt, 'string');
});

test('NEVER clobbers existing data (scores, photos of both shapes, sections)', () => {
  const original = {
    mrn: '42', name: 'Real Patient', dob: '1950-01-01',
    visits: [{
      id: 'v1', savedAt: '2026-07-01T00:00:00Z', toolTitle: 'DFU',
      area: 6.1, bwat: 22, reductionPct: 30, score: { num: '4', label: 'SINBAD' },
      images: ['data:image/jpeg;base64,AAAA', { path: '42/v1/1.jpg' }],   // both photo shapes stay
      alerts: [{ sev: 'warn', text: 'x' }],
      sections: [{ title: 'Healing metrics', items: [{ label: 'Wound area', value: '6.1 cm²' }] }]
    }]
  };
  const p = migratePatient(JSON.parse(JSON.stringify(original)));
  const v = p.visits[0];
  assert.equal(v.area, 6.1); assert.equal(v.bwat, 22);
  assert.deepEqual(v.images, ['data:image/jpeg;base64,AAAA', { path: '42/v1/1.jpg' }]);  // photos untouched, both forms
  assert.deepEqual(v.alerts, original.visits[0].alerts);
  assert.deepEqual(v.sections, original.visits[0].sections);
  assert.equal(v.id, 'v1');
});

test('replaces a malformed (null) visit rather than crashing', () => {
  const p = migratePatient({ mrn: '1', visits: [null, { id: 'ok', savedAt: '2026-01-01' }] });
  assert.equal(typeof p.visits[0].id, 'string');
  assert.ok(Array.isArray(p.visits[0].images));
  assert.equal(p.visits[1].id, 'ok');
});

test('coerces a non-string mrn and missing name', () => {
  const p = migratePatient({ mrn: 1042, visits: [] });
  assert.equal(p.mrn, '1042');
  assert.equal(p.name, '');
});

test('does not throw on null / non-object input', () => {
  assert.equal(migratePatient(null), null);
  assert.equal(migratePatient(undefined), undefined);
  assert.equal(migratePatient(5), 5);
});

test('migrateAll upgrades every record and tolerates junk', () => {
  const map = { A: { mrn: 'A', visits: [] }, B: { mrn: 'B' } };
  const out = migrateAll(map);
  assert.equal(out.A.schemaVersion, 1);
  assert.equal(out.B.schemaVersion, 1);
  assert.deepEqual(migrateAll(null), {});
  assert.deepEqual(migrateAll(undefined), {});
});
