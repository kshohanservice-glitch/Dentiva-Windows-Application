import type { DB } from '../database';

/**
 * Prescription-level free-text medicine instruction (v4.1.3).
 *
 * Some doctors write the whole medicine line by hand —
 * `Tab.Napa - 100MG - 1+0+1 - 7 days - after meals` — instead of filling every
 * structured field. That single line now has its own optional column.
 *
 * Strictly additive and backward compatible:
 *  - one nullable column, no table rebuild, no data rewrite;
 *  - every existing prescription keeps `medicine_instruction = NULL` and opens,
 *    prints and exports exactly as before;
 *  - the structured `prescription_items` rows are untouched, so medicine
 *    history, templates and the printed medicine list are unchanged;
 *  - databases created before this migration are upgraded in place by the
 *    normal forward-only startup migration.
 */
export const migration007 = {
  version: 7,
  name: 'prescription-medicine-instruction',
  up(db: DB): void {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(prescriptions)').all() as { name: string }[]).map((r) => r.name),
    );
    if (!columns.has('medicine_instruction')) {
      db.exec('ALTER TABLE prescriptions ADD COLUMN medicine_instruction TEXT');
    }
  },
};
