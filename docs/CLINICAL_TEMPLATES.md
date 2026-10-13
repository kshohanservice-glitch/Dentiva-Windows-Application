# Reusable clinical templates (schema migration 005)

Templates are optional, shared drafting aids. A template **fills the current form only**: applying or deleting one does not alter a previously saved visit, prescription, invoice, payment, or patient record.

- **Visit:** chief complaint, history, examination, diagnosis, treatment plan, advice, internal notes. Separate plan and notes templates can update just one field.
- **Prescription text:** C/C, O/E, R/E, diagnosis, treatment, advice and follow-up. An instructions template updates advice alone. The pre-existing `medicine_templates` continue to handle medicine rows; migration 005 does not replace or drop them.
- **Invoice item set:** descriptions, quantities, integer-paisa unit prices and optional treatment IDs. The invoice date, patient, discount, payment details and staff identity are deliberately never copied from a template. An inactive/missing catalog treatment is detached when applied, retaining its saved description and price snapshot.

Authorized users can select a template and **Apply to draft** (with confirmation if it would overwrite entered fields), save the current draft under a name, replace an existing name with confirmation, or delete a selected template with confirmation. The name is case-insensitively unique *per kind*. Template saving is independent of record submission. Do not put patient-identifying or secret data in a shared template. Audit records contain template kind/name and action, never the template body.

Permissions: visit/plan/notes require `clinical.visit.create`, prescription/instructions require `clinical.prescription.create`, invoice item sets require `billing.invoice.create`; the same permission is enforced by the main process for list, save and delete. Demo mode cannot save/delete templates. The service validates allowed fields, text lengths, item count, positive quantities, safe integer prices and treatment IDs before writing.

Migration 005 is additive to v3.0.3 → migrations 003/004. Existing Queue, financial and clinical rows remain untouched. Template records are included in database backups; a restore to an earlier snapshot necessarily restores that snapshot's templates. The business reset flow removes templates only after its pre-reset backup and explicit confirmation.

**Verification:** integration tests cover six kinds, validation, permission denial, upsert, deletion and v3.0.3 migration/restore. An Electron E2E draft-template path is added but must pass on the final Windows commit. Physical device/visual accessibility review is pending. Consult `RELEASE_EXECUTION_JOURNAL.md` for actual gate status.
