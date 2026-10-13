import type { DB } from '../database';

/** Additive template storage. Historic prescriptions/visits/invoices are untouched. */
export const migration005 = {
  version: 5,
  name: 'clinical-templates',
  up(db: DB): void {
    db.exec(`
      CREATE TABLE clinical_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('visit','plan','notes','prescription','instructions','invoice_items')),
        name TEXT NOT NULL COLLATE NOCASE,
        body_json TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(kind, name)
      );
      CREATE INDEX idx_clinical_templates_kind ON clinical_templates(kind, name);
    `);
  },
};
