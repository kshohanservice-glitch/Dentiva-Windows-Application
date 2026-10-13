# Dentiva Pro 4.0.0 — Windows production release

Offline Windows x64 dental-clinic application. This release upgrades the 3.1.0 database in place; it does not replace the clinic's data with demo data.

## Highlights

1. **Printed, previewed and exported documents now always show real amounts.** Money masking remains a screen-only privacy aid; `****` can no longer reach a print preview, a saved PDF, a physical page or a report CSV.
2. **Global search results are aligned for every category.** Category labels sit in a fixed-width column beside the result title and no longer overlap or spill out of the search box.
3. **Login and the dashboard show your clinic's own identity** — configured clinic name and logo — with `Dentiva Pro` as the sub-line in both places. The clinic logo is now included in backups.

## Changes

### Financial documents (masking never leaks)

- `PrintMoney` is the single authoritative money renderer for print, preview and export. It uses the same shared integer-exact `formatBdt` as the rest of the app, so no document can render a differently-rounded figure.
- `print.css` no longer contains a screen/print media pair. There is exactly one `.print-money` rule, so the on-screen preview is genuinely WYSIWYG: what you see is what the PDF contains.
- The print/report toolbar no longer offers a reveal control — there is nothing to reveal in a document, and no way to request a masked export.
- `PrintPage` no longer formats money with its own floating-point helper; every amount now flows through the shared formatter. Renderer `bdt()` delegates to the same code.
- Screen masking is unchanged: per-amount and global reveal, cleared on lock and logout. No global setting is mutated and no authorisation check is weakened.

### Global search layout

- Result rows are a CSS grid with a fixed 104 px category column and a fluid body column. Labels (`PATIENT`, `APPOINTMENT`, `INVOICE`, `PAYMENT`, `PRESCRIPTION`, `PATIENT_FILE`, `TREATMENT`, `VISIT`, `NOTE`, `STOCK`, `STAFF`, …) never wrap or intrude into the title.
- Duplicate/conflicting `.search-hit` rule blocks were removed; there is now exactly one canonical block, so all categories render identically.
- Titles and sub-lines ellipsise instead of overflowing the modal, and the modal itself is capped so it cannot exceed the window.
- The search list is excluded from the shell-wide title-case transform, so patient names, patient codes and invoice numbers are displayed as stored.
- Keyboard behaviour is unchanged: `↑`/`↓` to move, `Enter` to open, `Esc` to close and return focus.

### Clinic branding

- Login and the dashboard header render the configured clinic name and logo from Settings → Clinic. The product name `Dentiva Pro` is the sub-line in both, so the same identity appears in both places.
- Fallbacks: no clinic name configured → a generic clinic name; no logo, an unreadable logo or a broken image → the product mark. Long clinic names ellipsise with a native tooltip, and the header column shrinks instead of overflowing.
- New `ClinicLogo` / `ClinicName` components are shared by both surfaces; the About screen and the first-run setup wizard still identify `Dentiva Pro` as the product.
- Logo uploads are validated by file signature (PNG/JPEG/WEBP/SVG) before being stored, so a mislabelled or truncated file is rejected with a clear message instead of producing a broken image everywhere.

### Data integrity, security and reliability

- `.dpv` backups now archive and restore the `branding/` directory (the clinic logo) alongside `attachments/`, so restoring a backup no longer silently strips the clinic's letterhead from the login screen, the dashboard and every printed document. The archive allow-list bounds branding entries (traversal and size limits). The backup format version is unchanged because the manifest schema is unchanged and the new directory is additive; restoring a v4 backup in v3 is not supported.
- The logo data URL is capped and revalidated when read, so a corrupt or oversized file cannot be pushed through IPC.
- Removed dead code (`bdtShort`) and a redundant ESLint disable directive; the lint gate is now completely clean.

### Tests and gates

- 308 unit/integration tests pass (253 before this release). New suites: `print-money`, `search-hit-row`, `branding` (unit) and `branding` (integration, including the backup/restore round-trip), plus five new archive-safety cases.
- Typecheck (main + renderer), ESLint, `npm audit --omit=dev --audit-level=moderate` and the production build are green.

## Installation and upgrade

1. **Before upgrading:** in 3.1.0 make a manual `.dpv` backup using Settings → Backup, copy it to separate storage, and confirm the backup is readable. Keep the prior installer and a separate copy of the database. Do not test restore on the clinic's only data copy.
2. Download `DentivaPro-Setup-4.0.0.exe` and `SHA256SUMS.txt` from this release. Verify the installer SHA-256 against the checksum file before running it (Windows PowerShell: `Get-FileHash .\DentivaPro-Setup-4.0.0.exe -Algorithm SHA256`). Do not use an Actions artifact from a different commit or version.
3. Close Dentiva Pro. Run the NSIS installer as the intended Windows user. The per-user installation keeps application data when uninstalling (`deleteAppDataOnUninstall: false`). Launch and sign in, verify patient counts, historical financial records, appointment reminders and printing on the clinic's own equipment.
4. If migration or validation fails, stop using the updated app; preserve the backup and current data directory for investigation. Downgrading the updated database into 3.1.0 is **not supported**. Restore a pre-upgrade copy on a separate device or with qualified assistance rather than overwriting live data blindly.

## Compatibility and known limitations

- Windows x64 NSIS installer; native SQLite and Argon2 bindings are built and smoke-tested by Windows CI, which also silently installs the produced installer and runs the installed application.
- **Not verified in this release environment:** physical printer output and PDF content (including Bengali glyph shaping), long-page pagination, paper sizes and orientation, DPI/layout at 100–200% scaling, and assistive-technology review. Automated checks cover the money-rendering contract and the absence of a screen/print media swap at the DOM/CSS level; they do not replace a real print pass on clinic equipment.
- Money masking is a screen privacy aid, not encryption or a substitute for role permissions; exported files, print spoolers and saved PDFs contain real values. Keep them secure.
- Restoring a v4.0.0 backup into v3.1.0 or earlier is not supported (the v3 app will reject the unexpected `branding/` directory). Upgrading is forward-only.
- Some route changes and forms do not yet prompt on unsaved edits; server-side payment idempotency and full attachment/filesystem failure simulation remain incomplete. Avoid repeated payment clicks and verify a payment ledger entry before retrying after an error.
- Application data are not claimed to be encrypted at rest. Activation on packaged Windows requires OS secure storage; development/non-Windows behavior is weaker. No physical-device secure-storage validation was performed here.

See `docs/RELEASE_EXECUTION_JOURNAL.md` for commit-specific test evidence and remaining risks. Existing `v3.1.0` assets and tag are unchanged.
