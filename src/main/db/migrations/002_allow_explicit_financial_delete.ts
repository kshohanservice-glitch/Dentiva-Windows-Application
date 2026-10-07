import type { DB } from '../database';

export const migration002 = {
  version: 2,
  name: 'allow-explicit-financial-record-deletion',
  up(db: DB): void {
    // The product now exposes an explicit, permission-gated delete action for
    // invoices/payments. Keep the existing UI/service guardrails, but remove
    // the old DB-level append-only blockers so an intentional delete can
    // actually remove the complete invoice/payment record.
    db.exec(`
      DROP TRIGGER IF EXISTS trg_payments_no_delete;
      DROP TRIGGER IF EXISTS trg_invoice_items_no_delete;
    `);
  },
};
