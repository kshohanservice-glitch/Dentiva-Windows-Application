import type { DB } from '../database';

/**
 * Appointments become a reminder-only schedule (Dentiva Pro 3.1).
 *
 *  - `expired_at`: set automatically when an OPEN appointment's date has passed
 *    (local midnight). Expiry is a timestamp, not a status, so the historical
 *    status of the row is preserved and expired rows remain auditable.
 *  - `planned_treatments`: free-text list of planned procedures for the visit.
 *
 * Additive only: no table rebuild, no data rewrite, no deletions. Existing
 * installations keep every appointment row unchanged.
 */
export const migration004 = {
  version: 4,
  name: 'appointment-lifecycle',
  up(db: DB): void {
    db.exec(`
      ALTER TABLE appointments ADD COLUMN expired_at TEXT;
      ALTER TABLE appointments ADD COLUMN planned_treatments TEXT;
      CREATE INDEX idx_appt_active_date ON appointments(date, time)
        WHERE deleted_at IS NULL AND expired_at IS NULL;
    `);
  },
};
