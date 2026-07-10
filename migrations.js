/* ============================================================================
   CuraNova — saved-record schema versioning & migrations (pure, tested)

   Every patient record carries a `schemaVersion`. `migratePatient(p)` brings a
   record of any older/unknown shape up to the CURRENT version in one place, so
   the rest of the app only ever deals with the current shape and old records
   keep rendering correctly as the app evolves — a guarantee, not luck.

   Design:
   • Idempotent: running it on an already-current record is a cheap no-op.
   • Additive & defensive: it fills MISSING baseline fields (so a malformed old
     record can't render blank or throw) but never clobbers existing data.
   • It does NOT normalise photo entries — a visit image is legitimately EITHER
     an inline data-URL string OR a {path} reference; both are valid at v1.

   To add a future migration: raise SCHEMA_VERSION, add an `if (v < N) { …; v = N; }`
   block below (transform the record, then bump v), and add a test for it.

   Dual environment: defines globals in the browser (classic <script>) and
   exports for Node tests via the module guard at the bottom.
   ========================================================================== */

const SCHEMA_VERSION = 1;

function migratePatient(p) {
  if (!p || typeof p !== 'object') return p;
  let v = (typeof p.schemaVersion === 'number') ? p.schemaVersion : 0;
  if (v >= SCHEMA_VERSION) return p;   // fast path: already current

  // v0 → v1: establish baseline invariants so any historically-shaped record
  //          renders safely (arrays present, every visit identifiable).
  if (v < 1) {
    if (!Array.isArray(p.visits)) p.visits = [];
    if (p.mrn != null && typeof p.mrn !== 'string') p.mrn = String(p.mrn);
    if (p.name == null) p.name = '';
    p.visits.forEach((vis, i) => {
      if (!vis || typeof vis !== 'object') { p.visits[i] = { id: 'v_mig_' + i, savedAt: new Date(0).toISOString(), images: [], alerts: [], sections: [] }; return; }
      if (!vis.id) vis.id = 'v_mig_' + i;
      if (!vis.savedAt) vis.savedAt = new Date(0).toISOString();
      if (!Array.isArray(vis.images)) vis.images = [];
      if (!Array.isArray(vis.alerts)) vis.alerts = [];
      if (!Array.isArray(vis.sections)) vis.sections = [];
    });
    v = 1;
  }

  // if (v < 2) { …transform…; v = 2; }   ← future migrations go here

  p.schemaVersion = v;
  return p;
}

/* Migrate a whole {mrn: patient} map in place; returns the same object. */
function migrateAll(patients) {
  if (!patients || typeof patients !== 'object') return patients || {};
  Object.keys(patients).forEach(mrn => { patients[mrn] = migratePatient(patients[mrn]); });
  return patients;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SCHEMA_VERSION, migratePatient, migrateAll };
}
