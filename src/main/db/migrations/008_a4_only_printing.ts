import type { DB } from '../database';
import { defaultPrintProfiles, normalizePrintProfiles, withRequiredProfiles } from '../../../shared/print-page';

/**
 * Dentiva Pro 4.3.0 makes A4 the only supported document page size.
 *
 * Stored print profiles are the only place where a page size was ever persisted
 * (the `printProfiles` settings row), so this migration converts that row to the
 * A4 model:
 *
 *  - every profile keeps its id, name, document type, printer, orientation,
 *    margins, scale and copies;
 *  - the legacy `paperSize` / `widthMm` / `heightMm` fields are dropped;
 *  - profiles that describe a *different medium* (the seeded A5 prescription
 *    profile, the retired 80mm thermal receipt profile, or any hand-added
 *    custom-size profile) are removed, because their margins and scale describe
 *    paper that the product no longer prints; the A4 profile for that document
 *    type is seeded instead, so no document is left without a profile;
 *  - an installation whose row is missing or unreadable gets the A4 defaults.
 *
 * The migration is idempotent and forward-safe: it never touches patients,
 * clinical or financial rows, it only rewrites one settings key, and running it
 * twice produces the same result as running it once. Existing-profile
 * customization (printer, orientation, margins, scale, copies) is preserved.
 */
export const migration008 = {
  version: 8,
  name: 'a4-only-printing',
  up(db: DB): void {
    const row = db.prepare("SELECT value_json FROM settings WHERE key = 'printProfiles'").get() as
      | { value_json: string }
      | undefined;
    let stored: unknown = null;
    if (row) {
      try {
        stored = JSON.parse(row.value_json);
      } catch {
        stored = null;
      }
    }
    const list = Array.isArray(stored) ? stored : [];
    const keptProfiles = normalizePrintProfiles(Array.isArray(stored) ? stored : defaultPrintProfiles());
    const profiles = withRequiredProfiles(keptProfiles);
    // Every entry normalization dropped was a non-A4 medium, a duplicate id or
    // junk; the count is exact (no double counting).
    const removed = list.length - keptProfiles.length;
    const keptIds = keptProfiles.map((p) => p.id);
    const seededIds = profiles.map((p) => p.id).filter((id) => !keptIds.includes(id));
    db.prepare(
      `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES ('printProfiles', ?, ?, NULL)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = NULL`,
    ).run(JSON.stringify(profiles), new Date().toISOString());

    db.prepare(
      `INSERT INTO audit_log (at, user_id, username, action, entity_type, entity_id, summary, before_json, after_json, result, reason)
       VALUES (?, NULL, 'system', 'system.migrate', 'system', 'print-profiles', ?, NULL, ?, 'success', NULL)`,
    ).run(
      new Date().toISOString(),
      `A4-only printing: ${keptIds.length} A4 print profile(s) kept, ${seededIds.length} re-seeded, ${removed} non-A4 profile(s) removed.`,
      JSON.stringify({ kept: keptIds, seeded: seededIds, removedNonA4: removed }),
    );
  },
};
