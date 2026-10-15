# Dentiva Pro v5 — feature parity matrix

The matrix was built from the baseline commit `303712e` (v4.2.3) before any v5 change. Its sources are the
renderer routes and pages, every `api['…']` call in the renderer, the IPC router, the service layer and the
test suites.

**Purpose:** no existing behaviour may disappear, be simplified, or change its data, validation, permission or
error semantics without a recorded decision.

Column key:

- **Perm.** Permission enforced in the service layer. UI gating is cosmetic.
- **Tests (baseline).** Automated coverage that existed before v5. `e2e:` means a Playwright Electron spec
  that runs on Windows CI only.
- **v5 change.** Planned or applied change. `—` means none planned.
- **Verification.** How parity was proven after the change. It stays empty until it has actually been run.
- **Status values:**
  - `baseline` — present, not yet re-verified on the v5 branch.
  - `preserved` — re-verified after v5 changes.
  - `changed` — behaviour intentionally changed with a decision reference.

Service paths are relative to `src/main/services/`. Pages are in `src/renderer/pages/`.

## A. Start-up, activation, setup, authentication, session

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests (baseline) | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | Single-instance lock; second launch focuses the window | OS | `index.ts` | — | — | — | e2e (implicit) | — | | baseline |
| A-02 | Fail closed when Windows secure storage is unavailable (packaged) | dialog | `index.ts buildCipher` | activation/state.bin | — | — | activation.test | — | | baseline |
| A-03 | DB open + migrations + `quick_check`; fatal dialog with data/backup paths on failure | dialog | `db/database.ts` | dentiva.db | — | — | database.test, migration-v303 | pre-migration snapshot (V5-007); migration 008 (A4) | | baseline |
| A-04 | Offline activation (derived verifier, PBKDF2, no plaintext code) | SetupWizard step 1 | `core/activation.ts` | state.bin + audit | none (pre-auth) | `activation/status`, `activation/verify` | activation.test, e2e | — | | baseline |
| A-05 | First-run setup: clinic, ≥1 dentist, owner account, auto-lock, backup destination | SetupWizard | `auth.ts completeSetup` | settings, dentists, users | none (only while 0 users, after activation) | `setup/status`, `setup/complete` | auth.test, e2e | logoPath no longer accepted from renderer (V5-006) | | baseline |
| A-06 | Sign in (Argon2id, constant-time dummy verify, lockout after N failures for 5 min, disabled/locked accounts refused, audit) | Login | `auth.ts login` | users, audit_log | — | `auth/login` | auth.test, e2e | — | | baseline |
| A-07 | Session in main process; permissions reloaded per call | — | `core/session.ts` | — | — | all auth channels | rbac.test | disabled/locked accounts end the session (V5-002) | | baseline |
| A-08 | Manual lock (Ctrl+L) + idle auto-lock (5/10/15/30/60 min or off); print windows closed on lock/logout | header lock, timer | `session.ts`, `index.ts onLock` | settings.security | — | `system/lock`, `system/activity`, `event/lock` | auth.test | — | | baseline |
| A-09 | Unlock with password; failed attempts audited | LockOverlay | `session.unlock` | audit_log | — | `auth/unlock` | auth.test | lockout after `maxFailedLogins` failures (V5-001) | | baseline |
| A-10 | Sign out (audit) | user menu | router | audit_log | — | `auth/logout` | e2e | — | | baseline |
| A-11 | Change own password (current password required, policy length, letters+digits) | Settings → Security | `auth.ts changePassword` | users | session | `auth/change-password` | auth.test | — | | baseline |
| A-12 | Session-expired broadcast returns UI to login | — | router AUTH handling | — | — | `event/session-expired` | e2e (indirect) | — | | baseline |
| A-13 | Demo build: auto sign-in, read-only enforcement in main process | demo installer | router `demoBlocked` | separate data dir | — | all mutations | — | allow-list enforcement (V5-003) | | baseline |

## B. Dashboard, search, notifications

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B-01 | KPI cards (patients/appointments/visits today, paid today, dues, low stock, expiring); finance values only with `dashboard.finance` | Dashboard | `dashboard.ts` | multiple | `dashboard.view` (+`dashboard.finance`) | `dashboard/get` | module-coverage, rbac-personas, scale-20k | visual redesign only | | baseline |
| B-02 | Today's appointments, recent patients, outstanding invoices, recent payments lists | Dashboard | `dashboard.ts` | — | as above | `dashboard/get` | module-coverage | visual only | | baseline |
| B-03 | Dashboard "Backup now", "New appointment", Refresh | Dashboard | backup service | backups | `backup.create` | `backup/run` | e2e | — | | baseline |
| B-04 | Global search (Ctrl+K) across patients, appointments, prescriptions, invoices, payments with permission-redacted results; fixed category column | header | `search.ts` | — | per category | `search/global` | search-hit-row, e2e | visual only | | baseline |
| B-05 | Notifications (low stock, dues, backup, appointments) deduplicated per day; mark read / mark all read; preferences | header bell, Settings → Notifications | `notifications.ts` | notifications | session | `notifications/list`, `notifications/mark-read` | module-coverage | — | | baseline |
| B-06 | Screen money masking (`****`) with per-amount and global reveal, reset on lock/logout; never masks printed/exported documents | header "Show amounts", money cells | `components/money` | memory only | — | — | money-mask, formatted-money, print-money, e2e | — | | baseline |

## C. Patients and clinical records

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C-01 | Patient list: search, date-range/status filters, paging, sorting | Patients | `patients.ts listPatients` | patients | `patients.view` | `patients/list` | patients.test, scale-20k | visual only | | baseline |
| C-02 | Register patient (Bengali name, DOB or age, gender, blood group, phones, WhatsApp number + consent, address, emergency contact, histories) with duplicate detection | Register modal | `createPatient`, `checkDuplicates` | patients, patient_histories | `patients.create` | `patients/create`, `patients/duplicates` | patients.test, e2e | — | | baseline |
| C-03 | Edit patient | profile → Edit | `updatePatient` | patients | `patients.edit` (+`patients.sensitive` for histories) | `patients/update` | patients.test | — | | baseline |
| C-04 | Archive patient | profile → Archive | `archivePatient` | patients.status | `patients.edit` | `patients/archive` | patients.test | — | | baseline |
| C-05 | Delete patient (typed confirmation, history-safe) | profile → Delete | `deletePatient` | patients + dependants | `patients.delete` / `data.delete` | `patients/delete` | e2e, module-coverage | — | | baseline |
| C-06 | Patient CSV export (BOM, audited) | Patients → Export CSV | `patientCsvRows` + router | file | `data.export` | `patients/export` | module-coverage | — | | baseline |
| C-07 | Patient profile tabs: overview, visits, dental chart, prescriptions, invoices, WhatsApp & documents, referrals, attachments, history timeline | profile | several | several | per tab | `patients/get`, `patients/timeline`, … | patients.test | visual redesign | | baseline |
| C-08 | Visits: create/edit/delete, treatments with qty + price snapshot, follow-up, complete visit, link invoice | profile → New visit | `visits.ts` | visits, visit_treatments | `clinical.visit.create` / `.edit`, `data.delete` | `visits/*` | module-coverage, e2e | — | | baseline |
| C-09 | Dental chart (FDI adult/paediatric), condition + severity, supersede history, delete entry | profile → Dental chart | `chart.ts` | tooth_conditions | `clinical.view`, `clinical.chart.edit` | `chart/get`, `chart/set`, `chart/delete` | module-coverage, e2e | — | | baseline |
| C-10 | Referrals in/out: create, edit, delete | profile → Referrals | `referrals.ts` | referrals | `clinical.referral.manage` | `referrals/*` | module-coverage | — | | baseline |
| C-11 | Attachments: add (allow-list + magic bytes, 100 MB), list, open, export, delete; rename (backend only) | profile/invoice → Attachments | `attachments.ts` | attachments + files | entity permission + `patients.sensitive` | `attachments/*` | attachment-security | — | | baseline |
| C-12 | Clinical templates (visit/prescription/invoice drafts) list/save/delete, case-insensitive names, kind permissions | template picker | `clinical-templates.ts` | clinical_templates | kind-specific | `clinical-templates/*` | clinical-templates, e2e | — | | baseline |

## D. Prescriptions

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D-01 | Create prescription: C/C, O/E (options + Other), R/E, diagnosis, treatment, advice, follow-up, medicines (structured fields + optional one-line instruction ≤ 500 chars verbatim) | profile → New prescription | `prescriptions.ts` | prescriptions, prescription_items | `clinical.prescription.create` | `prescriptions/create` | prescription-medicine-instruction, e2e | — | | baseline |
| D-02 | Prescription list + view | Prescriptions | `listPrescriptions`, `getPrescription` | — | `clinical.view` | `prescriptions/list`, `/get` | module-coverage | — | | baseline |
| D-03 | Delete prescription | profile | `deletePrescription` | — | `data.delete` | `prescriptions/delete` | module-coverage | — | | baseline |
| D-04 | Medicine templates: save on create, list, apply, delete; standalone save (backend only) | prescription form | `listTemplates`, `saveTemplate`, `deleteTemplate` | medicine_templates | `clinical.prescription.create`, `data.delete` | `prescriptions/templates`, `/save-template`, `/delete-template` | module-coverage | item validation (V5-009) | | baseline |
| D-05 | Print prescription and watermarked duplicate | print window | PrintPage | — | `clinical.prescription.print` (data via view perms) | `reports/print` | e2e | A4-only | | baseline |

## E. Appointments

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | Agenda by day/dentist/status, patient search filter | Appointments | `appointments.ts listAgenda` | appointments | `appointments.view` | `appointments/agenda`, `/list` | appointment-lifecycle | visual only | | baseline |
| E-02 | Book appointment with planned treatments; conflict detection; override needs `appointments.override` | New appointment | `createAppointment`, `appointment-rules.ts` | appointments | `appointments.manage` (+override) | `appointments/create` | appointment-lifecycle, e2e | — | | baseline |
| E-03 | Reschedule with explicit confirmation (keeps id), edit, status changes | Appointments | `updateAppointment` | appointments | `appointments.manage` | `appointments/update` | appointment-lifecycle, e2e | — | | baseline |
| E-04 | Cancel with reason, no-show, delete | Appointments | `cancel`/`markNoShow`/`delete` | appointments | `appointments.manage` / `data.delete` | `appointments/cancel`, `/no-show`, `/delete` | appointment-lifecycle | — | | baseline |
| E-05 | Local-midnight expiry marker + reminder sync at start-up and every 5 min | — | `runAppointmentExpiry` | appointments.expired_at | system | — | appointment-lifecycle | — | | baseline |
| E-06 | Appointment card print | Appointments → card | PrintPage | — | `appointments.view` | `reports/print` | — | A4-only | | baseline |
| E-07 | Legacy Queue route redirects to Appointments; queue rows kept as archive | `#/queue` | App.tsx | queue_entries (read-only archive) | — | — | migration-v303 | — | | baseline |

## F. Billing and payments

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | Invoice list (range/status filters, paging) | Invoice | `billing.ts listInvoices` | invoices | `billing.invoice.view` | `invoices/list` | billing.test | visual only | | baseline |
| F-02 | Create invoice: lines (treatment picker or free text), qty, unit price, line discount, invoice discount, integer paisa maths shared with walk-in; yearly number sequence or configured next number | profile → Create invoice | `createInvoice`, `billing-math.ts`, `core/sequences.ts` | invoices, invoice_items, sequences | `billing.invoice.create` | `invoices/create` | billing.test, billing-math, e2e | visitId/treatmentId validation (V5-008) | | baseline |
| F-03 | Invoice detail with payment history | Invoice → row | `getInvoice` | — | `billing.invoice.view` | `invoices/get` | billing.test | — | | baseline |
| F-04 | Void invoice with reason (audited) | invoice detail | `voidInvoice` | invoices | `billing.invoice.void` | `invoices/void` | billing.test | — | | baseline |
| F-05 | Delete invoice (removes its payments, unlinks visit, audited) | invoice detail | `deleteInvoice` | invoices, payments | `data.delete` | `invoices/delete` | audit-regressions | — | | baseline |
| F-06 | Record payment (cash/bank/card/bKash/Nagad/Rocket/Upay/other), status recompute, overpayment audit | invoice → Receive payment | `createPayment` | payments | `billing.payment.create` | `payments/create` | billing.test, e2e | — | | baseline |
| F-07 | Refund (≤ net paid on invoice), original row untouched | payments → Refund | `createPayment(type=refund)` | payments | `billing.payment.refund` | `payments/create` | billing.test | — | | baseline |
| F-08 | Delete payment (audited, status recompute) | payments | `deletePayment` | payments | `data.delete` | `payments/delete` | audit-regressions | — | | baseline |
| F-09 | Payments list (range/method filters) | Payments | `listPayments` | — | `billing.payment.view` | `payments/list` | billing.test | local-day range bounds (V5-012) | | baseline |
| F-10 | Invoice and receipt print / Save PDF; real amounts always printed | print window | PrintPage | — | invoice/payment view | `reports/print`, `reports/save-pdf` | print-money, e2e | A4-only | | baseline |

## G. Walk-in / Quick Documents

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G-01 | Prescription, invoice, receipt, visit summary, appointment card for unregistered customers; renderer + main validation; payload in memory (2 h, 24 docs); no patient/financial/clinical rows; audit only | Walk-in / Quick Docs | `quick-documents.ts`, `shared/quick-documents.ts` | memory + audit_log | create + print permission of the kind | `quick-documents/prepare`, `/payload` | quick-documents, e2e (×9 responsive) | A4-only print | | baseline |
| G-02 | Walk-in invoice line editor: item, qty, unit price, discount, line total in two rows at every supported width | Quick invoice tab | QuickDocuments.tsx + CSS | — | — | — | ui-layout-regressions, e2e responsive | two-row grid (from PR #42) | | baseline |

## H. Treatments, inventory, accounting, staff

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H-01 | Treatment catalogue: create/edit (code, names, category, price, duration), activate/deactivate, delete | Treatments | `treatments.ts` | treatments | `treatments.view` / `.manage`, `data.delete` | `treatments/*` | module-coverage | — | | baseline |
| H-02 | Inventory items, batches (expiry, qty ≥ 0 ledger), stock in/out/adjust/damage/expire/return, suppliers | Inventory | `inventory.ts` | inventory_* | `inventory.view` / `.manage`, `data.delete` | `inventory/*` | module-coverage, rbac-personas | — | | baseline |
| H-03 | Stock and expiring-stock label sheets | Inventory → Print labels | PrintPage `stock-labels` | — | `inventory.view` | `reports/print` | — | A4-only | | baseline |
| H-04 | Accounting: expenses, incomes, categories (add/delete) | Accounting | `accounting.ts` | expenses, incomes, account_categories | `accounting.view` / `.manage` | `accounting/*` | module-coverage | — | | baseline |
| H-05 | Staff records with salary visible only with `staff.salary.view` | Staff | `staff.ts` | staff | `staff.view` / `.manage` / `.salary.view` | `staff/*` | rbac.test | — | | baseline |
| H-06 | Dentist profiles (qualifications, reg. no., schedule) | Staff → Dentists | `staff.ts` | dentists | `staff.manage` | `dentists/*` | module-coverage | — | | baseline |

## I. Administration, settings, backup, audit, reports

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I-01 | Users: create/edit (role, staff link, status), reset password, delete | Users & Roles | `users.ts` | users | `users.manage` | `users/*` | rbac.test | — | | baseline |
| I-02 | Roles: custom roles with permission matrix; built-ins protected | Users & Roles | `users.ts` | roles, role_permissions | `roles.manage` | `roles/*` | rbac.test, permissions | — | | baseline |
| I-03 | Audit log (insert-only via triggers): search, action filter, date filters, CSV export | Audit Log | `users.ts listAudit` | audit_log | `audit.view` (+`data.export`) | `audit/list`, `reports/export` | audit-regressions | — | | baseline |
| I-04 | Settings: clinic identity (+Bengali name), logo upload (signature-checked), prescription labels/footer, invoice next number/footer, security policy, appearance (theme/density/animations/sidebar), notifications, payment methods, WhatsApp time zone/greetings | Settings tabs | `settings.ts` | settings | `settings.manage` | `settings/*` | branding, module-coverage | logoPath hardening (V5-006) | | baseline |
| I-05 | Print profiles: per document type, printer, orientation, margins, scale, copies; printer enumeration | Settings → Printing | `settings.ts` + `print.ts listPrinters` | settings.printProfiles | `settings.manage` | `settings/save`, `printers/list` | print.test | A4-only model; paper column removed | | baseline |
| I-06 | Customize Documents: per-element style overrides for 7 document types; live preview; reset element/section/document | Settings → Customize Documents | `shared/document-styles.ts` | settings.documentStyles | `settings.manage` | `settings/save` | document-styles, document-customization, document-layout | — | | baseline |
| I-07 | Clinic-logo watermark (off by default; size 15–70 %, opacity 0.04–0.3; eligible documents only) | Settings → Customize Documents | `shared/document-watermark.ts` | settings.documentWatermark | `settings.manage` | `settings/save` | document-watermark | geometry A4-only | | baseline |
| I-08 | Delete all business data (Owner only, typed clinic name, password, pre-reset backup) | Settings → Data | `settings.resetBusiness` | all business tables | `data.delete` + owner role | `settings/reset-business` | module-coverage | — | | baseline |
| I-09 | Manual backup (.dpv zip with manifest + hash), configured destination | Backup & Restore / Dashboard | `backup.ts` | backups dir | `backup.create` | `backup/run`, `backup/list` | backup.test, backup-security | — | | baseline |
| I-10 | Automatic backup (7/15/30 days or off) with retention | Backup & Restore | `backup.autoBackupIfDue` | settings.backup | `settings.manage` | `backup/set-auto` | backup.test | — | | baseline |
| I-11 | Restore: staged validation (manifest, containment, counts, hash, integrity), typed confirm, pre-restore backup, rollback on failure | Backup & Restore | `backup.restoreBackup`, `archive-safety.ts` | whole data dir | `backup.restore` | `backup/restore` | backup-security, archive-safety | — | | baseline |
| I-12 | 14 reports with per-report permission, CSV export, print | Reports | `reports.ts`, `shared/reports.ts` | — | per report | `reports/run`, `/export`, `/print` | phase-a-findings, module-coverage, e2e | local-day ranges (V5-012); A4-only | | baseline |
| I-13 | About: product identity, version/schema, data folder, printer list, developer credit | About | router `system/info` | — | — | `system/info`, `printers/list` | e2e | — | | baseline |

## J. WhatsApp (free Click to Chat only)

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J-01 | Message templates: list, create, edit, duplicate, enable/disable, delete, restore built-ins | Settings → Message Templates | `whatsapp.ts` | whatsapp_templates | `settings.manage` (+view) | `whatsapp/templates/*` | whatsapp.test | — | | baseline |
| J-02 | Prepare message (placeholders, greeting by time zone) and open a strictly validated `https://wa.me` link; copy-link fallback with clipboard read-back | patient → WhatsApp & Documents | `whatsapp.ts`, router | whatsapp_message_log | `patients.view` | `whatsapp/prepare`, `/open`, `/copy-link` | whatsapp.test, whatsapp-open-ipc | — | | baseline |
| J-03 | Prepare patient documents as PDFs for manual sharing; history with status updates | WhatsApp & Documents | `whatsapp.ts` | files + log | per document | `whatsapp/documents`, `/prepare-documents`, `/history`, `/history/status` | whatsapp.test | A4 PDFs | | baseline |

## K. Cross-cutting

| ID | Behaviour | Evidence | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| K-01 | Every invoke channel has exactly one handler; preload exposes only allow-listed channels | script check in BASELINE_AUDIT §2 | add a permanent test | | baseline |
| K-02 | Errors over IPC never include stacks; correlation id logged | `errors.ts toWireError` | — | | baseline |
| K-03 | Rotating, redacting logs | `logger.ts` | — | | baseline |
| K-04 | Keyboard shortcuts (Ctrl+K, Ctrl+N, Ctrl+L, Alt+1..9, Esc …) and unsaved-change guards | `components/shell.tsx`, `shared/unsaved.ts` | — | | baseline |
| K-05 | Light/dark theme, compact density, animation switch, reduced-motion support | `tokens.css` | redesign keeps all four | | baseline |
| K-06 | Bengali text input and rendering with bundled Noto Sans Bengali | fonts in bundle | typography tokens for bn | | baseline |
