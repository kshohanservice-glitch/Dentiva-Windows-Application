import type { DB } from '../database';

/**
 * Dentiva Pro 3.1 removes the Queue subsystem from the product.
 *
 * Data preservation (see docs/QUEUE_REMOVAL.md):
 *  - `queue_entries` is NOT dropped. Those rows can carry visit-flow history
 *    for past days; they stay in the database as a dormant archive that no
 *    screen, IPC channel or service reads or writes.
 *  - Appointment rows are NOT rewritten. Legacy appointment statuses
 *    (arrived / in_queue / in_treatment) keep their stored value; their
 *    meaning is documented, not migrated.
 *  - Only the permission catalogue entries for `queue.*` are removed. The
 *    foreign-key cascade removes their role and user grants with them.
 *  - One audit row records the removal and the number of archived rows.
 */
export const migration003 = {
  version: 3,
  name: 'retire-queue-subsystem',
  up(db: DB): void {
    const legacyRows = Number(
      (db.prepare('SELECT COUNT(*) AS n FROM queue_entries').get() as { n: number }).n,
    );
    db.prepare("DELETE FROM permissions WHERE key LIKE 'queue.%'").run();
    db.prepare("DELETE FROM role_permissions WHERE permission_key LIKE 'queue.%'").run();
    db.prepare("DELETE FROM user_permission_overrides WHERE permission_key LIKE 'queue.%'").run();
    db.prepare(
      `INSERT INTO audit_log (at, user_id, username, action, entity_type, entity_id, summary, before_json, after_json, result, reason)
       VALUES (?, NULL, 'system', 'system.migrate', 'system', 'queue', ?, NULL, NULL, 'success', NULL)`,
    ).run(new Date().toISOString(), `Queue subsystem retired in v3.1; ${legacyRows} legacy queue row(s) archived, not deleted.`);
  },
};
