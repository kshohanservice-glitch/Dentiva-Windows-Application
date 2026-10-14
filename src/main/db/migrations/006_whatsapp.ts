import type { DB } from '../database';
import { DEFAULT_WHATSAPP_TEMPLATES } from '../../../shared/whatsapp';

/**
 * Free WhatsApp messaging (v4.1.0). Strictly additive:
 * - patients gain a separate, optional WhatsApp number plus consent state.
 *   Existing rows keep their phone numbers untouched and get no invented
 *   WhatsApp number (NULL) and no assumed consent ('unknown').
 * - whatsapp_templates holds the local, editable Bengali message templates.
 *   Defaults are seeded with INSERT OR IGNORE so an administrator's edited
 *   copy is never overwritten by re-running this migration or an upgrade.
 * - whatsapp_message_log records message *preparation* and the doctor's own
 *   reported outcome. It is not a delivery receipt and stores only a short
 *   preview, never a full clinical document.
 * The whole database (including these tables) already travels inside the
 * existing .dpv backup format, so backup/restore needs no format change.
 */
export const migration006 = {
  version: 6,
  name: 'free-whatsapp-messaging',
  up(db: DB): void {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(patients)').all() as { name: string }[]).map((r) => r.name),
    );
    const add = (ddl: string, name: string) => {
      if (!columns.has(name)) db.exec(ddl);
    };
    add('ALTER TABLE patients ADD COLUMN whatsapp_number TEXT', 'whatsapp_number');
    add('ALTER TABLE patients ADD COLUMN whatsapp_same_as_phone INTEGER NOT NULL DEFAULT 0', 'whatsapp_same_as_phone');
    add("ALTER TABLE patients ADD COLUMN whatsapp_consent TEXT NOT NULL DEFAULT 'unknown'", 'whatsapp_consent');
    add('ALTER TABLE patients ADD COLUMN whatsapp_consent_at TEXT', 'whatsapp_consent_at');
    db.exec('CREATE INDEX IF NOT EXISTS idx_patients_whatsapp ON patients(whatsapp_number)');

    db.exec(`
      CREATE TABLE IF NOT EXISTS whatsapp_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        body TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_category ON whatsapp_templates(category, enabled);

      CREATE TABLE IF NOT EXISTS whatsapp_message_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id),
        template_id INTEGER REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
        template_key TEXT,
        category TEXT,
        destination_number TEXT,
        message_preview TEXT,
        documents_json TEXT,
        status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','sent','not_sent','unknown')),
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_whatsapp_log_patient ON whatsapp_message_log(patient_id, created_at);
    `);

    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO whatsapp_templates (key, name, category, body, is_default, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, NULL, ?, ?)`,
    );
    for (const t of DEFAULT_WHATSAPP_TEMPLATES) {
      insert.run(t.key, t.name, t.category, t.body, now, now);
    }
  },
};
