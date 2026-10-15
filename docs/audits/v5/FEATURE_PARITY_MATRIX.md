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
  - `preserved` — re-verified after v5 changes; behaviour unchanged (presentation may differ).
  - `changed` — behaviour intentionally changed with an issue or decision reference.

**Verification state (v5 branch).** Every row has been re-verified. Named tests are the vitest suites in
`tests/` (run locally and in the Windows CI verify job); "Windows E2E" is the Playwright Electron suite that runs
only on GitHub Actions; "PDF audit" and "harness" are `scripts/layout-audit.mjs` runs in Chromium 153 (not a
physical printer). Run IDs, commits and counts are in [TEST_RESULTS.md](TEST_RESULTS.md). No row was removed and
no behaviour was dropped; `changed` rows are hardening, A4-only printing or documented fixes.

Service paths are relative to `src/main/services/`. Pages are in `src/renderer/pages/`.

## A. Start-up, activation, setup, authentication, session

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests (baseline) | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | Single-instance lock; second launch focuses the window | OS | `index.ts` | — | — | — | e2e (implicit) | — | Windows E2E launches the packaged app (CI); lock code untouched | preserved |
| A-02 | Fail closed when Windows secure storage is unavailable (packaged) | dialog | `index.ts buildCipher` | activation/state.bin | — | — | activation.test | — | activation.test | preserved |
| A-03 | DB open + migrations + `quick_check`; fatal dialog with data/backup paths on failure | dialog | `db/database.ts` | dentiva.db | — | — | database.test, migration-v303 | pre-migration safety copy (V5-007); migration 008 converts print profiles to A4 (V5-020/022, D-6) | database.test, migration-v303/v422, a4-only-printing (migration 008 on fixtures + a real v4.2.2 DB), v5-security (pre-migration copy written, verified, pruned to 3; none on fresh install); installed smoke (CI) | changed |
| A-04 | Offline activation (derived verifier, PBKDF2, no plaintext code) | SetupWizard step 1 | `core/activation.ts` | state.bin + audit | none (pre-auth) | `activation/status`, `activation/verify` | activation.test, e2e | — (V5-018: code derivable from public sources — owner decision) | activation.test, Windows E2E | preserved |
| A-05 | First-run setup: clinic, ≥1 dentist, owner account, auto-lock, backup destination | SetupWizard | `auth.ts completeSetup` | settings, dentists, users | none (only while 0 users, after activation) | `setup/status`, `setup/complete` | auth.test, e2e | logoPath no longer accepted from renderer (V5-006) | auth.test, v5-security (setup and settings ignore a renderer logoPath), Windows E2E setup | changed |
| A-06 | Sign in (Argon2id, constant-time dummy verify, lockout after N failures for 5 min, disabled/locked accounts refused, audit) | Login | `auth.ts login` | users, audit_log | — | `auth/login` | auth.test, e2e | — | auth.test, Windows E2E sign-in | preserved |
| A-07 | Session in main process; permissions reloaded per call | — | `core/session.ts` | — | — | all auth channels | rbac.test | disabled/locked accounts end the session (V5-002) | v5-security: disabled/locked user → next call AUTH, session ended | changed |
| A-08 | Manual lock (Ctrl+L) + idle auto-lock (5/10/15/30/60 min or off); print windows closed on lock/logout | header lock, timer | `session.ts`, `index.ts onLock` | settings.security | — | `system/lock`, `system/activity`, `event/lock` | auth.test | — | auth.test | preserved |
| A-09 | Unlock with password; failed attempts audited | LockOverlay | `session.unlock` | audit_log | — | `auth/unlock` | auth.test | lockout after `maxFailedLogins` failures (V5-001) | v5-security: lockout after maxFailedLogins, audit rows, sign-out | changed |
| A-10 | Sign out (audit) | user menu | router | audit_log | — | `auth/logout` | e2e | — | Windows E2E | preserved |
| A-11 | Change own password (current password required, policy length, letters+digits) | Settings → Security | `auth.ts changePassword` | users | session | `auth/change-password` | auth.test | — | auth.test | preserved |
| A-12 | Session-expired broadcast returns UI to login | — | router AUTH handling | — | — | `event/session-expired` | e2e (indirect) | — | Windows E2E (indirect); v5-security AUTH path | preserved |
| A-13 | Demo build: auto sign-in, read-only enforcement in main process | demo installer | router `demoBlocked` | separate data dir | — | all mutations | — | allow-list enforcement (V5-003); also blocks whatsapp/prepare* and quick-documents/prepare (D-11) | access-policy.test (allow-list: unknown/new channels blocked in demo) | changed |

## B. Dashboard, search, notifications

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B-01 | KPI cards (patients/appointments/visits today, paid today, dues, low stock, expiring); finance values only with `dashboard.finance` | Dashboard | `dashboard.ts` | multiple | `dashboard.view` (+`dashboard.finance`) | `dashboard/get` | module-coverage, rbac-personas, scale-20k | visual redesign; stock KPIs follow inventory access, not finance access (V5-034) | module-coverage, rbac-personas, scale-20k; harness screens (light/dark) | changed |
| B-02 | Today's appointments, recent patients, outstanding invoices, recent payments lists | Dashboard | `dashboard.ts` | — | as above | `dashboard/get` | module-coverage | visual only | module-coverage; harness screens | preserved |
| B-03 | Dashboard "Backup now", "New appointment", Refresh | Dashboard | backup service | backups | `backup.create` | `backup/run` | e2e | manual backup permission now enforced in the main process (V5-013); UI unchanged | v5-security (backup/run: assistant/receptionist denied, owner allowed); Windows E2E | changed |
| B-04 | Global search (Ctrl+K) across patients, appointments, prescriptions, invoices, payments with permission-redacted results; fixed category column | header | `search.ts` | — | per category | `search/global` | search-hit-row, e2e | visual only | search-hit-row, Windows E2E | preserved |
| B-05 | Notifications (low stock, dues, backup, appointments) deduplicated per day; mark read / mark all read; preferences | header bell, Settings → Notifications | `notifications.ts` | notifications | session | `notifications/list`, `notifications/mark-read` | module-coverage | — | module-coverage | preserved |
| B-06 | Screen money masking (`****`) with per-amount and global reveal, reset on lock/logout; never masks printed/exported documents | header "Show amounts", money cells | `components/money` | memory only | — | — | money-mask, formatted-money, print-money, e2e | — | money-mask, formatted-money, print-money; Windows E2E reveal | preserved |

## C. Patients and clinical records

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C-01 | Patient list: search, date-range/status filters, paging, sorting | Patients | `patients.ts listPatients` | patients | `patients.view` | `patients/list` | patients.test, scale-20k | visual only | patients.test, scale-20k | preserved |
| C-02 | Register patient (Bengali name, DOB or age, gender, blood group, phones, WhatsApp number + consent, address, emergency contact, histories) with duplicate detection | Register modal | `createPatient`, `checkDuplicates` | patients, patient_histories | `patients.create` | `patients/create`, `patients/duplicates` | patients.test, e2e | — | patients.test, Windows E2E; axe scan (WhatsApp consent select now named, V5-035) | preserved |
| C-03 | Edit patient | profile → Edit | `updatePatient` | patients | `patients.edit` (+`patients.sensitive` for histories) | `patients/update` | patients.test | — | patients.test | preserved |
| C-04 | Archive patient | profile → Archive | `archivePatient` | patients.status | `patients.delete` | `patients/archive` | patients.test | — | patients.test; permission corrected in this matrix (code unchanged: `patients.ts` `requirePermission(ctx, 'patients.delete')`) | preserved |
| C-05 | Delete patient (typed confirmation, history-safe) | profile → Delete | `deletePatient` | patients + dependants | `patients.delete` / `data.delete` | `patients/delete` | e2e, module-coverage | — | Windows E2E, module-coverage | preserved |
| C-06 | Patient CSV export (BOM, audited) | Patients → Export CSV | `patientCsvRows` + router | file | `data.export` | `patients/export` | module-coverage | — | module-coverage | preserved |
| C-07 | Patient profile tabs: overview, visits, dental chart, prescriptions, invoices, WhatsApp & documents, referrals, attachments, history timeline | profile | several | several | per tab | `patients/get`, `patients/timeline`, … | patients.test | visual redesign | patients.test; harness screens | preserved |
| C-08 | Visits: create/edit/delete, treatments with qty + price snapshot, follow-up, complete visit, link invoice | profile → New visit | `visits.ts` | visits, visit_treatments | `clinical.visit.create` / `.edit`, `data.delete` | `visits/*` | module-coverage, e2e | omitted visit time defaults to local wall-clock time like UI-created visits (V5-012, D-7) | module-coverage, Windows E2E, v5-local-dates | changed |
| C-09 | Dental chart (FDI adult/paediatric), condition + severity, supersede history, delete entry | profile → Dental chart | `chart.ts` | tooth_conditions | `clinical.view`, `clinical.chart.edit` | `chart/get`, `chart/set`, `chart/delete` | module-coverage, e2e | chart entry `visitId` must belong to the patient (V5-008 hardening); dentition switch is a toggle group (V5-035) | module-coverage, Windows E2E, v5-security (foreign visit rejected); axe scan | changed |
| C-10 | Referrals in/out: create, edit, delete | profile → Referrals | `referrals.ts` | referrals | `clinical.referral.manage` | `referrals/*` | module-coverage | — | module-coverage | preserved |
| C-11 | Attachments: add (allow-list + magic bytes, 100 MB), list, open, export, delete; rename (backend only) | profile/invoice → Attachments | `attachments.ts` | attachments + files | entity permission + `patients.sensitive` | `attachments/*` | attachment-security | — | attachment-security | preserved |
| C-12 | Clinical templates (visit/prescription/invoice drafts) list/save/delete, case-insensitive names, kind permissions | template picker | `clinical-templates.ts` | clinical_templates | kind-specific | `clinical-templates/*` | clinical-templates, e2e | — | clinical-templates, Windows E2E | preserved |

## D. Prescriptions

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D-01 | Create prescription: C/C, O/E (options + Other), R/E, diagnosis, treatment, advice, follow-up, medicines (structured fields + optional one-line instruction ≤ 500 chars verbatim) | profile → New prescription | `prescriptions.ts` | prescriptions, prescription_items | `clinical.prescription.create` | `prescriptions/create` | prescription-medicine-instruction, e2e | — | prescription-medicine-instruction, Windows E2E | preserved |
| D-02 | Prescription list + view | Prescriptions | `listPrescriptions`, `getPrescription` | — | `clinical.view` | `prescriptions/list`, `/get` | module-coverage | — | module-coverage | preserved |
| D-03 | Delete prescription | profile | `deletePrescription` | — | `data.delete` | `prescriptions/delete` | module-coverage | — | module-coverage | preserved |
| D-04 | Medicine templates: save on create, list, apply, delete; standalone save (backend only) | prescription form | `listTemplates`, `saveTemplate`, `deleteTemplate` | medicine_templates | `clinical.prescription.create`, `data.delete` | `prescriptions/templates`, `/save-template`, `/delete-template` | module-coverage | item validation (V5-009) | v5-security (template items cleaned; missing template → NOT_FOUND) | changed |
| D-05 | Print prescription and watermarked duplicate | print window | PrintPage | — | `clinical.prescription.print` (data via view perms) | `reports/print` | e2e | A4-only (V5-020/022, D-6); multi-page margins and pagination (V5-026/028) | a4-only-printing, v5-print-chain, PDF audit (A4, multi-page, duplicate watermark), Windows E2E | changed |

## E. Appointments

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | Agenda by day/dentist/status, patient search filter | Appointments | `appointments.ts listAgenda` | appointments | `appointments.view` | `appointments/agenda`, `/list` | appointment-lifecycle | visual only | appointment-lifecycle | preserved |
| E-02 | Book appointment with planned treatments; conflict detection; override needs `appointments.override` | New appointment | `createAppointment`, `appointment-rules.ts` | appointments | `appointments.manage` (+override) | `appointments/create` | appointment-lifecycle, e2e | — | appointment-lifecycle, Windows E2E | preserved |
| E-03 | Reschedule with explicit confirmation (keeps id), edit, status changes | Appointments | `updateAppointment` | appointments | `appointments.manage` | `appointments/update` | appointment-lifecycle, e2e | — | appointment-lifecycle, Windows E2E | preserved |
| E-04 | Cancel with reason, no-show, delete | Appointments | `cancel`/`markNoShow`/`delete` | appointments | `appointments.manage` / `data.delete` | `appointments/cancel`, `/no-show`, `/delete` | appointment-lifecycle | — | appointment-lifecycle | preserved |
| E-05 | Local-midnight expiry marker + reminder sync at start-up and every 5 min | — | `runAppointmentExpiry` | appointments.expired_at | system | — | appointment-lifecycle | — | appointment-lifecycle | preserved |
| E-06 | Appointment card print | Appointments → card | PrintPage | — | `appointments.view` | `reports/print` | — | A4-only; the time prints as 02:30 PM on every PC instead of following the PC's language settings (V5-033) | PDF audit (appointment card and quick card: A4, margins; times read 10:00 AM and 05:30 PM); v5-locale (card time) | changed |
| E-07 | Legacy Queue route redirects to Appointments; queue rows kept as archive | `#/queue` | App.tsx | queue_entries (read-only archive) | — | — | migration-v303 | — | migration-v303 | preserved |

## F. Billing and payments

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | Invoice list (range/status filters, paging) | Invoice | `billing.ts listInvoices` | invoices | `billing.invoice.view` | `invoices/list` | billing.test | visual only | billing.test | preserved |
| F-02 | Create invoice: lines (treatment picker or free text), qty, unit price, line discount, invoice discount, integer paisa maths shared with walk-in; yearly number sequence or configured next number | profile → Create invoice | `createInvoice`, `billing-math.ts`, `core/sequences.ts` | invoices, invoice_items, sequences | `billing.invoice.create` | `invoices/create` | billing.test, billing-math, e2e | visitId/treatmentId validation (V5-008) | billing.test, billing-math, v5-security (another patient's visit and a missing treatment rejected), Windows E2E | changed |
| F-03 | Invoice detail with payment history | Invoice → row | `getInvoice` | — | `billing.invoice.view` | `invoices/get` | billing.test | — | billing.test, Windows E2E (status badge "Paid") | preserved |
| F-04 | Void invoice with reason (audited) | invoice detail | `voidInvoice` | invoices | `billing.invoice.void` | `invoices/void` | billing.test | — | billing.test | preserved |
| F-05 | Delete invoice (removes its payments, unlinks visit, audited) | invoice detail | `deleteInvoice` | invoices, payments | `data.delete` | `invoices/delete` | audit-regressions | — | audit-regressions | preserved |
| F-06 | Record payment (cash/bank/card/bKash/Nagad/Rocket/Upay/other), status recompute, overpayment audit | invoice → Receive payment | `createPayment` | payments | `billing.payment.create` | `payments/create` | billing.test, e2e | — | billing.test, Windows E2E | preserved |
| F-07 | Refund (≤ net paid on invoice), original row untouched | payments → Refund | `createPayment(type=refund)` | payments | `billing.payment.refund` | `payments/create` | billing.test | — | billing.test | preserved |
| F-08 | Delete payment (audited, status recompute) | payments | `deletePayment` | payments | `data.delete` | `payments/delete` | audit-regressions | — | audit-regressions | preserved |
| F-09 | Payments list (range/method filters) | Payments | `listPayments` | — | `billing.payment.view` | `payments/list` | billing.test | local-day range bounds (V5-012) | v5-local-dates (TZ=Asia/Dhaka: 00:00–05:59 local payments counted on the right day) | changed |
| F-10 | Invoice and receipt print / Save PDF; real amounts always printed | print window | PrintPage | — | invoice/payment view | `reports/print`, `reports/save-pdf` | print-money, e2e | A4-only; multi-page margins (V5-026) | print-money, v5-print-chain, PDF audit (৳ embedded, 70-line invoice on 5 A4 sheets), Windows E2E | changed |

## G. Walk-in / Quick Documents

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G-01 | Prescription, invoice, receipt, visit summary, appointment card for unregistered customers; renderer + main validation; payload in memory (2 h, 24 docs); no patient/financial/clinical rows; audit only | Walk-in / Quick Docs | `quick-documents.ts`, `shared/quick-documents.ts` | memory + audit_log | create + print permission of the kind | `quick-documents/prepare`, `/payload` | quick-documents, e2e (×9 responsive) | A4-only print | quick-documents, Windows E2E (×9 responsive), PDF audit (5 quick documents) | changed |
| G-02 | Walk-in invoice line editor: item, qty, unit price, discount, line total in two rows at every supported width | Quick invoice tab | QuickDocuments.tsx + CSS | — | — | — | ui-layout-regressions, e2e responsive | two-row grid (from PR #42) | ui-layout-regressions, Windows E2E responsive, harness walk-in invoice (0 violations in 8 panels) | changed |

## H. Treatments, inventory, accounting, staff

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H-01 | Treatment catalogue: create/edit (code, names, category, price, duration), activate/deactivate, delete | Treatments | `treatments.ts` | treatments | `treatments.view` / `.manage`, `data.delete` | `treatments/*` | module-coverage | — | module-coverage | preserved |
| H-02 | Inventory items, batches (expiry, qty ≥ 0 ledger), stock in/out/adjust/damage/expire/return, suppliers | Inventory | `inventory.ts` | inventory_* | `inventory.view` / `.manage`, `data.delete` | `inventory/*` | module-coverage, rbac-personas | — | module-coverage, rbac-personas | preserved |
| H-03 | Stock and expiring-stock label sheets | Inventory → Print labels | PrintPage `stock-labels` | — | `inventory.view` | `reports/print` | — | A4-only | PDF audit (stock labels: A4) | changed |
| H-04 | Accounting: expenses, incomes, categories (add/delete) | Accounting | `accounting.ts` | expenses, incomes, account_categories | `accounting.view` / `.manage` | `accounting/*` | module-coverage | — | module-coverage | preserved |
| H-05 | Staff records with salary visible only with `staff.salary.view` | Staff | `staff.ts` | staff | `staff.view` / `.manage` / `.salary.view` | `staff/*` | rbac.test | — | rbac.test | preserved |
| H-06 | Dentist profiles (qualifications, reg. no., schedule) | Staff → Dentists | `staff.ts` | dentists | `staff.manage` | `dentists/*` | module-coverage | — | module-coverage | preserved |

## I. Administration, settings, backup, audit, reports

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I-01 | Users: create/edit (role, staff link, status), reset password, delete | Users & Roles | `users.ts` | users | `users.manage` | `users/*` | rbac.test | exact-set overrides, owner protection, privilege ceiling, self guard (V5-014/015/016, D-8) | v5-security (role change revokes old permissions, unticked permission revoked, overrides cleared, last active Owner protected, Owner-only delete of Owners, privilege ceiling, no self role/status change), rbac.test, audit-regressions (ISS-010 updated, D-8) | changed |
| I-02 | Roles: custom roles with permission matrix; built-ins protected | Users & Roles | `users.ts` | roles, role_permissions | `roles.manage` | `roles/*` | rbac.test, permissions | non-owners cannot grant permissions they do not hold (V5-016) | v5-security, rbac.test, permissions | changed |
| I-03 | Audit log (insert-only via triggers): search, action filter, date filters, CSV export | Audit Log | `users.ts listAudit` | audit_log | `audit.view` (+`data.export`) | `audit/list`, `reports/export` | audit-regressions | date filter uses the clinic's local day, like the audit report (V5-012, V5-037) | audit-regressions, v5-local-dates (audit log filter uses local days; the page used UTC days until V5-037) | changed |
| I-04 | Settings: clinic identity (+Bengali name), logo upload (signature-checked), prescription labels/footer, invoice next number/footer, security policy, appearance (theme/density/animations/sidebar), notifications, payment methods, WhatsApp time zone/greetings | Settings tabs | `settings.ts` | settings | `settings.manage` | `settings/*` | branding, module-coverage | logoPath hardening (V5-006) | branding, module-coverage, v5-security (non-image / outside branding/ never served) | changed |
| I-05 | Print profiles: per document type, printer, orientation, margins, scale, copies; printer enumeration | Settings → Printing | `settings.ts` + `print.ts listPrinters` | settings.printProfiles | `settings.manage` | `settings/save`, `printers/list` | print.test | A4-only model; paper column removed; legacy profiles converted (V5-020/022/023, D-6) | print.test, a4-only-printing, migration 008 fixtures (customised profiles converted, untouched seeds dropped, audit row) | changed |
| I-06 | Customize Documents: per-element style overrides for 7 document types; live preview; reset element/section/document | Settings → Customize Documents | `shared/document-styles.ts` | settings.documentStyles | `settings.manage` | `settings/save` | document-styles, document-customization, document-layout | — | document-styles, document-customization; axe scan (preview is a keyboard-reachable region) | preserved |
| I-07 | Clinic-logo watermark (off by default; size 15–70 %, opacity 0.04–0.3; eligible documents only) | Settings → Customize Documents | `shared/document-watermark.ts` | settings.documentWatermark | `settings.manage` | `settings/save` | document-watermark | geometry A4-only | document-watermark | changed |
| I-08 | Delete all business data (Owner only, typed clinic name, password, pre-reset backup) | Settings → Data | `settings.resetBusiness` | all business tables | `data.delete` + owner role | `settings/reset-business` | module-coverage | — | module-coverage | preserved |
| I-09 | Manual backup (.dpv zip with manifest + hash), configured destination | Backup & Restore / Dashboard | `backup.ts` | backups dir | `backup.create` | `backup/run`, `backup/list` | backup.test, backup-security | permission enforced in the main process (V5-013) | backup.test, backup-security, v5-security (`backup/run` requires backup.create) | changed |
| I-10 | Automatic backup (7/15/30 days or off) with retention | Backup & Restore | `backup.autoBackupIfDue` | settings.backup | `settings.manage` | `backup/set-auto` | backup.test | retention prunes only tracked automatic backups (V5-017) | v5-security (manual and pre-restore backups survive retention) | changed |
| I-11 | Restore: staged validation (manifest, containment, counts, hash, integrity), typed confirm, pre-restore backup, rollback on failure | Backup & Restore | `backup.restoreBackup`, `archive-safety.ts` | whole data dir | `backup.restore` | `backup/restore` | backup-security, archive-safety | — | backup-security, archive-safety | preserved |
| I-12 | 14 reports with per-report permission, CSV export, print | Reports | `reports.ts`, `shared/reports.ts` | — | per report | `reports/run`, `/export`, `/print` | phase-a-findings, module-coverage, e2e | local-day ranges (V5-012); A4-only; printed reports show their totals (V5-027) | phase-a-findings, module-coverage, v5-local-dates, v5-print-chain (printed totals), PDF audit (150-row report: 5 A4 sheets), Windows E2E | changed |
| I-13 | About: product identity, version/schema, data folder, printer list, developer credit | About | router `system/info` | — | — | `system/info`, `printers/list` | e2e | — | Windows E2E | preserved |

## J. WhatsApp (free Click to Chat only)

| ID | Behaviour | UI entry | Logic | Data | Perm. | IPC | Tests | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J-01 | Message templates: list, create, edit, duplicate, enable/disable, delete, restore built-ins | Settings → Message Templates | `whatsapp.ts` | whatsapp_templates | `settings.manage` (+view) | `whatsapp/templates/*` | whatsapp.test | — | whatsapp.test | preserved |
| J-02 | Prepare message (placeholders, greeting by time zone) and open a strictly validated `https://wa.me` link; copy-link fallback with clipboard read-back | patient → WhatsApp & Documents | `whatsapp.ts`, router | whatsapp_message_log | `patients.view` | `whatsapp/prepare`, `/open`, `/copy-link` | whatsapp.test, whatsapp-open-ipc | — | whatsapp.test, whatsapp-open-ipc; blocked in the demo build only (D-11) | preserved |
| J-03 | Prepare patient documents as PDFs for manual sharing; history with status updates | WhatsApp & Documents | `whatsapp.ts` | files + log | per document | `whatsapp/documents`, `/prepare-documents`, `/history`, `/history/status` | whatsapp.test | A4 PDFs; blocked in the demo build (D-11) | whatsapp.test; PDF audit | changed |

## K. Cross-cutting

| ID | Behaviour | Evidence | v5 change | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| K-01 | Every invoke channel has exactly one handler; preload exposes only allow-listed channels | script check in BASELINE_AUDIT §2 | permanent test added | ipc-surface.test (new, permanent): every invoke channel has exactly one handler; no raw channels; one pre-existing no-op handler on `event/session-expired` pinned | preserved |
| K-02 | Errors over IPC never include stacks; correlation id logged | `errors.ts toWireError` | — | `src/main/errors.ts` unchanged since baseline; service AppError codes asserted in v5-security | preserved |
| K-03 | Rotating, redacting logs | `logger.ts` | — | `src/main/logger.ts` unchanged since baseline (redaction pattern included) | preserved |
| K-04 | Keyboard shortcuts (Ctrl+K, Ctrl+N, Ctrl+L, Alt+1..9, Esc …) and unsaved-change guards | `components/shell.tsx`, `shared/unsaved.ts` | — | Windows E2E (Ctrl+K and other keyboard paths); `shared/unsaved.ts` unchanged | preserved |
| K-05 | Light/dark theme, compact density, animation switch, reduced-motion support | `tokens.css` | redesign keeps all four | harness light + dark: 0/200 layout violations; axe-core WCAG 2.1 AA: 0 in both themes; reduced-motion rules in global.css | preserved |
| K-06 | Bengali text input and rendering with bundled Noto Sans Bengali | fonts in bundle | typography tokens for bn; only the Bengali subset of Noto Sans Bengali is bundled (V5-032) | v5-print-chain (Bengali subset shipped), PDF audit (NotoSansBengali embedded, 0 replacement characters) | preserved |
| K-07 | Date entry: native date and date-and-time fields in forms; the app shows dates as dd/mm/yyyy | `components/forms.tsx` `Input`, `format.ts` | each form date field spells out the chosen date underneath ("Fri 3 Apr 2026"), because Windows draws the field in the PC's short date format (V5-033). Value format, validation and keyboard entry unchanged; filter bars unchanged | v5-locale; Windows E2E (read-back for 2026-04-03 and 2026-03-04, CI 38759566953); harness booking modal: layout 0/200, axe 0 | changed |
