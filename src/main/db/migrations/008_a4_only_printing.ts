import type { DB } from '../database';
import { defaultPrintProfiles, planPrintProfiles, withRequiredProfiles } from '../../../shared/print-page';

/**
 * Dentiva Pro 5.0 makes A4 the only supported document page size.
 *
 * Stored print profiles are the only place where a page size was ever persisted
 * (the `printProfiles` settings row), so this migration converts that row to the
 * A4 model (see `planPrintProfiles` in src/shared/print-page.ts):
 *
 *  - A4 profiles keep their id, name, document type, printer, orientation,
 *    margins, scale and copies; the legacy `paperSize` / `widthMm` / `heightMm`
 *    fields are dropped;
 *  - customised non-A4 profiles (A5, Letter, Legal, a custom page, a thermal
 *    roll) are **converted** to A4 instead of deleted: page-like media keep the
 *    printer, orientation, margins, scale and copies; roll/label media keep
 *    copies and orientation but not the receipt printer, margins or scale;
 *  - the seeded legacy profiles that a clinic never changed (`rx-a5`,
 *    `inv-thermal`) are removed — they carry no customization;
 *  - every document type ends up with at least one A4 profile, and an
 *    installation whose row is missing or unreadable gets the A4 defaults.
 *
 * The full before/after profile lists are written to the append-only audit log
 * (they contain printer names and margins only — no patient data), so the
 * conversion can be reviewed and, if needed, re-created by hand. The migration
 * is idempotent: running it again produces the same profile list.
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
    const plan = planPrintProfiles(Array.isArray(stored) ? stored : defaultPrintProfiles());
    const profiles = withRequiredProfiles(plan.profiles);
    const planIds = new Set(plan.profiles.map((p) => p.id));
    const seeded = profiles.map((p) => p.id).filter((id) => !planIds.has(id));
    db.prepare(
      `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES ('printProfiles', ?, ?, NULL)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = NULL`,
    ).run(JSON.stringify(profiles), new Date().toISOString());

    const printersCleared = plan.converted.filter((c) => c.printerCleared).length;
    db.prepare(
      `INSERT INTO audit_log (at, user_id, username, action, entity_type, entity_id, summary, before_json, after_json, result, reason)
       VALUES (?, NULL, 'system', 'system.migrate', 'system', 'print-profiles', ?, ?, ?, 'success', NULL)`,
    ).run(
      new Date().toISOString(),
      `A4-only printing: ${plan.kept.length} A4 profile(s) kept, ${plan.converted.length} converted to A4` +
        `${printersCleared ? ` (${printersCleared} roll-printer setting(s) not carried over)` : ''}, ` +
        `${plan.droppedSeeds.length} unchanged legacy default(s) removed, ${seeded.length} A4 default(s) added.`,
      row ? row.value_json.slice(0, 20000) : null,
      JSON.stringify({ kept: plan.kept, converted: plan.converted, removedLegacyDefaults: plan.droppedSeeds, seeded, droppedInvalid: plan.droppedInvalid }),
    );
  },
};
