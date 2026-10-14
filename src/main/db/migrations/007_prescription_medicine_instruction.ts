import type { DB } from '../database';

/**
 * Add the optional free-text medicine instruction without touching any existing
 * prescription fields or rows. The column is nullable so historic data and
 * older writers remain valid; the service accepts the field only when present.
 */
export const migration007 = {
  version: 7,
  name: 'prescription-medicine-instruction',
  up(db: DB): void {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(prescription_items)').all() as { name: string }[]).map((row) => row.name),
    );
    if (!columns.has('medicine_instruction')) {
      db.exec('ALTER TABLE prescription_items ADD COLUMN medicine_instruction TEXT');
    }
  },
};
