# Dentiva Pro 3.1.0 — Windows production release

Offline Windows x64 dental-clinic application. This release upgrades the 3.0.3 database in place; it does not replace the clinic's data with demo data.

## Changes

- Appointments are now reminders rather than a live Queue: Today, 7-day, 30-day and All views, in-place rescheduling, local-midnight expiry, and patient-linked reminders. The former Queue UI is removed, but historical Queue rows and appointment statuses are retained in the database.
- Financial amounts are masked as `****` on supported screens until revealed individually or with the global control. Lock and logout clear reveal state. Intentional print/PDF and CSV exports contain real financial figures and must be handled as sensitive records.
- Staff with the appropriate permissions can save and apply shared templates for visits, plans, notes, prescriptions, instructions and invoice items. Applying a template changes an unsaved draft, not an existing clinical record; replacing entered draft fields asks for confirmation.
- Backup/restore archive and attachment path validation were tightened; restore checks database integrity and makes a pre-restore backup. Additional CSV injection, IPC/permission, migration and financial tests were added. Visit, prescription, patient, invoice and payment drafts have additional close/discard and duplicate-submit guards.
- Additive database migrations 003–005 retain historical patients, appointments, visits, invoices, payments and legacy Queue rows. The app refuses to open a database written by a newer schema.

## Installation and upgrade

1. **Before upgrading:** in 3.0.3 make a manual `.dpv` backup using Settings → Backup, copy it to separate storage, and confirm the backup is readable. Keep the prior installer and a separate copy of the database. Do not test restore on the clinic's only data copy.
2. Download `DentivaPro-Setup-3.1.0.exe` and `SHA256SUMS.txt` from this release. Verify the installer SHA-256 against the checksum file before running it (Windows PowerShell: `Get-FileHash .\DentivaPro-Setup-3.1.0.exe -Algorithm SHA256`). Do not use an Actions artifact from a different commit or version.
3. Close Dentiva Pro. Run the NSIS installer as the intended Windows user. The per-user installation keeps application data when uninstalling (`deleteAppDataOnUninstall: false`). Launch and sign in, verify patient counts, historical financial records, appointment reminders and printing on the clinic's own equipment.
4. If migration or validation fails, stop using the updated app; preserve the backup and current data directory for investigation. Downgrading the updated database into 3.0.3 is **not supported**. Restore a pre-upgrade copy on a separate device or with qualified assistance rather than overwriting live data blindly.

## Compatibility and known limitations

- Windows x64 NSIS installer; native SQLite and Argon2 bindings are tested by Windows CI. No macOS/Linux installer is provided.
- Automated CI tests an upgrade from a disposable 3.0.3-format database and exercises a silent installation and app startup. **A representative real-clinic dataset upgrade, physical printer/PDF inspection (including Bengali glyphs), DPI and assistive-technology review have not been performed by the CI runner.** Clinic operators must validate these before relying on printouts or upgrading their only workstation.
- Money masking is a screen privacy aid, not encryption or a substitute for role permissions; exported files, print spoolers and saved PDFs contain real values. Keep them secure.
- Some route changes and forms do not yet prompt on unsaved edits; server-side payment idempotency and full attachment/filesystem failure simulation remain incomplete. Avoid repeated payment clicks and verify a payment ledger entry before retrying after an error.
- Application data are not claimed to be encrypted at rest. Activation on packaged Windows requires OS secure storage; development/non-Windows behavior is weaker. No physical-device secure-storage validation was performed here.

See `docs/RELEASE_EXECUTION_JOURNAL.md` for commit-specific test evidence and remaining risks. Existing `v3.0.3` assets and tag are unchanged.
