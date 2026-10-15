# Dentiva Pro — Security Model

## 1. Threat model (offline desktop)

Assets: patient clinical data, financial records, user credentials, audit trail, backup files.
Attacker classes considered: curious unauthorized staff member (primary), misused UI,
tampered renderer state, direct IPC calls, stolen backup file, casual file-system access.
Out of scope (documented honestly): a determined attacker with admin rights over the
Windows machine and the binary — offline software cannot fully resist local reverse
engineering (see §6 Activation honesty).

## 2. Authentication

- Argon2id via `@node-rs/argon2` with the OWASP baseline parameters m = 19,456 KiB,
  t = 2, p = 1 (`src/main/core/passwords.ts`), random salt, PHC string storage.
- Login: username + password → constant-time verify (a dummy verify runs for unknown users);
  failure counter `failed_attempts`; after `maxFailedLogins` consecutive failures (setting,
  default 5, clamped 3–20) the account is locked for 5 minutes (`locked_until`); every failure
  is audited.
- **Lock-screen unlock (v5, V5-001):** wrong unlock passwords are counted the same way; at
  `maxFailedLogins` the session ends (full sign-in required, which carries the account
  lockout) and the failure is recorded on the user row.
- **Account status (v5, V5-002):** every IPC call re-reads the signed-in user; a disabled or
  locked account is signed out on its next call (AUTH error → login screen).
- No plaintext password ever stored, logged, audited, or echoed in errors.
- Session lives in main process memory only; renderer receives non-sensitive profile info.
- Manual **Lock** (Ctrl+L) and **Auto-lock** (5/10/15/30 min, default 10; disable only via
  settings policy) → lock overlay requires password re-auth; cached patient/financial views
  are covered by the overlay; secondary print windows are closed. On logout
  secondary print windows close too. Clearing every mounted component and all OS
  print/PDF previews has not been independently verified.
- Logout clears session + audit.

## 3. Authorization (RBAC)

- Granular permission keys (~70) grouped: patients, clinical, billing, payments,
  inventory, accounting, staff, users, settings, backup, audit, reports, admin.
- Built-in roles: Owner (all), Administrator, Dentist, Dental Assistant, Receptionist,
  Accountant, Inventory Manager + custom roles.
- **Enforcement point:** `requirePermission(session, key)` inside the service layer before
  any read/write. IPC handler → session lookup → permission gate → service. UI hiding is
  cosmetic only.
- Financial permission (`finance.view`, `accounting.view`, `staff.salary.view`, …) checked
  in queries too: unauthorized roles receive redacted/absent values, including through
  global search and dashboard aggregates.
- Overrides (v5, V5-014): per-user grant/revoke rows on top of the role with **exact-set**
  semantics — the saved set is exactly what the administrator ticked (grants = desired − role,
  revokes = role − desired); clearing "Override" removes every override; changing a role never
  carries the old role's permissions.
- Account rules (v5, V5-015/016, decision D-8): nobody changes their own role, status or
  overrides; only an Owner may modify or delete an Owner; the last active Owner can never be
  demoted, disabled or deleted; a non-owner with `users.manage` / `roles.manage` can only
  assign permission sets they hold themselves (privilege ceiling).

## 4. Data layer protections

- Prepared statements only (no string-concat SQL) → SQLi defense.
- Audit log insert-only via SQLite triggers (UPDATE/DELETE rejected at DB level).
- Activation state uses Electron `safeStorage` (DPAPI on Windows). A packaged
  Windows build refuses to start if OS secure storage is unavailable; development
  and non-Windows builds retain a reduced-strength fallback. Ordinary settings
  and the SQLite database are not encrypted at rest by this claim.
- Attachments stored outside DB with generated random-suffix paths; original filename sanitized
  (strip path separators, control chars, reserved Windows names, length cap); path
  resolution validated to remain inside the attachments root (path-traversal defense);
  extension allowlist + magic-byte checks for images/PDF and executables; document
  formats are extension-checked, not full MIME-sniffed; size limit 100 MB. Entity
  permissions and active-target checks apply to add/list/open/rename/delete. This
  is not protection against a local administrator modifying the data directory.
- Backup restore stages and validates the manifest, path containment, file counts,
  database hash and SQLite integrity before swap. It takes a pre-restore backup and
  has rollback coverage on forced mid-swap failure. Test only on disposable data
  until Windows/device verification is complete.

## 5. Renderer hardening

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- CSP: `default-src 'self'; img-src 'self' data: file:; style-src 'self' 'unsafe-inline';
  font-src 'self'; connect-src 'none'` (no network at runtime).
- No `eval`, no remote content, no shell exposure via IPC; every IPC channel allowlisted.
- Error surfaces show friendly text + correlation id; logs and every clinical
  field still require a dedicated privacy review before release.

## 6. Activation (offline) — honest design

- Mandatory code: verified **only via a derived verifier**: PBKDF2-HMAC-SHA256
  (480k iters, per-install random salt in the verifier blob) of a machine-independent
  domain-separated derivation of the code; the plaintext code appears in **no** source,
  config, asset, test fixture, log, or error string. The verifier itself is stored
  XOR-sharded/assembled at runtime (not a single obvious literal) and compared with
  `crypto.timingSafeEqual`.
- Activation state is encrypted via safeStorage (DPAPI on packaged Windows) +
  flag file. Startup fails closed on packaged Windows when safeStorage is unavailable.
- **Honest limitation (documented in About/SECURITY.md):** because the app is fully offline
  and the activation secret is fixed, no purely local scheme makes the secret impossible to
  recover by sufficiently capable reverse engineering. We minimize attack surface, avoid
  plaintext, and avoid perfect-secrecy claims. No phone-home, no license server.

## 7. Logging & privacy

- Rotating file logs (5 × 2 MB), automatic cleanup; metadata keys matching
  `/(password|passphrase|token|secret|activation|credential|otp)/i` are written as
  `[redacted]` (`src/main/logger.ts`).
- Notifications avoid exposing clinical/financial detail to unauthorized users.
- No telemetry; no network sockets at runtime.

## 8. Supply chain

- Dependency inventory + license audit in docs/DEPENDENCY_AUDIT.md and
  THIRD_PARTY_NOTICES.md; only permissive licenses (MIT/Apache-2.0/BSD/ISC/OFL);
  `npm audit --omit=dev` clean required for release gate.

## 9. Destructive-action safeguards

- Delete/restore/business-reset flows: permission check → explicit warning dialog →
  typed confirmation (`DELETE`, clinic name, or amount) → transactional execution →
  audit record. Pre-restore automatic backup mandatory.

## 10. Money display and intentional exports (in progress)

- Financial amounts on supported screens default to `****`, with per-amount and
  global reveal buttons; reveal state is in memory and reset on lock/logout.
  Legacy report and audit summaries using BDT-formatted text are segmented before
  rendering. This is a visual privacy affordance, **not encryption** or RBAC.
- Masking is **screen-only by construction**. Documents (print preview, Save PDF,
  physical pages, report CSV) render the real amount through `PrintMoney` and the
  shared integer formatter; there is no masked node in the document tree and no
  media query that swaps one for the other, so `****` cannot leak into an export.
  Users must treat printed pages and saved PDF/CSV files as sensitive patient and
  financial data. OS print dialogs, exported CSV/PDF, audit databases and backups
  are not masked.
- Electron E2E, accessibility and physical print verification remain release gates;
  see `RELEASE_EXECUTION_JOURNAL.md`.

## 11. v5 hardening summary (2026-10-15)

Details, evidence and tests: `docs/audits/v5/SECURITY_AUDIT.md` and `ISSUE_REGISTER.md`.

| Area | Control | Issue |
| --- | --- | --- |
| Lock screen | Unlock attempts limited; session ends at `maxFailedLogins` | V5-001 |
| Sessions | Disabled/locked accounts lose their session on the next call | V5-002 |
| Demo build | Read-only by **allow-list** — unknown or new channels are blocked by default | V5-003, D-11 |
| Windows | Navigation allowed only to the packaged `index.html` (any hash) | V5-004 |
| Save as PDF | Always exports the print window, never the focused window | V5-005 |
| Clinic logo | The main process owns the path; only image files directly in `branding/` are served | V5-006 |
| Upgrades | Verified pre-migration copy of the database (newest 3 kept) | V5-007 |
| Billing / clinical links | `visitId` must exist and belong to the patient (invoices, prescriptions, chart); `treatmentId` must exist. A visit that already has an invoice keeps its first link (unchanged billing rule) | V5-008 |
| Medicine templates | Items validated; missing template → NOT_FOUND | V5-009 |
| Print window | Opening a document window requires that document's permission | V5-010 |
| Crash handling | Handlers registered at module start; boot failures reach the fatal dialog | V5-011 |
| Backups | `backup/run` requires `backup.create`; retention prunes only automatic backups | V5-013, V5-017 |
| Accounts | Exact-set overrides, Owner protection, privilege ceiling, self guard | V5-014–016 |

Open owner decision: the offline activation code is derivable from the public repository
(test helper) — V5-018. Activation remains an honest soft gate (§6); it is not an access
control for patient data.
