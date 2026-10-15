# Dentiva Pro 5.0.0

> **Status: release candidate. Not tagged, not published.** Remove this block when the release is authorized
> (see `docs/audits/v5/RELEASE_READINESS.md`). The installer SHA-256 is recorded from the CI run of the exact
> tagged commit, never from a branch build.

Dentiva Pro 5.0.0 is the v5 premium edition. It has a calmer, more consistent interface, A4-only printing that
holds up on long documents, and a hardened security and data-safety layer. Every existing feature, its data,
validation and permissions is kept. Behaviour changes are limited to the security fixes, A4 printing and the
documented corrections below.

## Interface

- **New design system.** Semantic colour, type, spacing, shape, depth and motion tokens, applied through shared
  components. Every pre-v5 token name still works.
- **Sentence case.** Labels, buttons and help text read as written ("Date of birth", not "Date Of Birth").
  Statuses and payment methods are formatted consistently ("Paid", "bKash"). Patient and clinic data are shown
  exactly as entered.
- **Calmer interface.** Flat headers, clear focus rings, quieter tables and badges, and short modal and toast
  motion. All motion is off with Windows reduced motion or the in-app animation switch.
- **Bengali.** Noto Sans Bengali is in the interface font stack, with a taller line height for Bengali text.
- **Accessibility.** An automated WCAG 2.1 AA scan (axe-core, 24 screens and dialogs, light and dark themes)
  now reports 0 issues:
  - Dark-theme buttons and selected states meet contrast. They measured as low as 1.9:1 before.
  - Fields and dialogs have proper names.
  - Scrollable previews are keyboard-reachable.
- **Dashboard.** Clickable statistic cards are real buttons. Stock figures follow inventory access instead of
  finance access.
- **Smaller install.** Only the font subsets the interface uses are bundled: renderer assets are 23 % smaller.

## Printing: A4 only

- **A4 only.** Every document prints on A4, portrait (210 × 297 mm) or landscape (297 × 210 mm). This covers
  invoice, receipt, prescription and its watermarked duplicate, visit summary, appointment card, stock labels,
  all 14 reports and the five walk-in documents. A5, Letter, thermal-roll and custom sizes are gone from
  settings, preview, PDF and printing. The main process enforces A4 as well.
- **Your print settings are converted, not lost.**
  - Customised legacy profiles become A4 profiles named "… (converted)".
  - Page-size profiles keep their printer, orientation, margins, scale and copies.
  - Thermal-roll profiles keep copies and orientation. Their printer, margins and scale are reset.
  - Untouched factory profiles are removed.
  - The change is recorded in the audit log with the previous settings.
- **Long documents print properly.**
  - Margins repeat on every sheet, and page 1 is no longer left blank.
  - Rows, medicines and totals never split across sheets, table headers repeat, and headings stay with their
    text.
  - Measured: a 70-line invoice prints on 5 sheets, a 30-medicine prescription on 2 and a 150-row report on 5.
- **Printed reports show their totals.** Before 5.0.0 the "Total" row was empty.
- **The taka sign ৳ always prints.** It falls back to the bundled Bengali font.

## Security and data safety

- **Lock screen.** Wrong unlock passwords are limited. After the configured number of failures the user is
  signed out.
- **Disabled or locked accounts** lose their session at once, instead of at their next sign-out.
- **Accounts:**
  - Changing a user's role no longer keeps the old role's permissions.
  - Unticking a permission revokes it.
  - Clearing "Override" removes all overrides.
  - Nobody can change their own role, status or overrides.
  - Only an Owner can change or delete an Owner, and the last active Owner is always kept.
  - Administrators cannot grant access they do not have themselves.
- **Backups:**
  - "Back up now" requires the backup permission in the main process, not only in the interface.
  - Automatic retention deletes only automatic backups, never manual or pre-restore backups.
- **Upgrades.** Before a database upgrade, Dentiva Pro writes and verifies a safety copy in
  `data/pre-migration` and keeps the newest three. If it cannot, the upgrade does not start and nothing is
  changed.
- **Hardening:**
  - Links from invoices, prescriptions and the dental chart to visits and treatments are validated.
  - The clinic-logo path is owned by the application.
  - Save as PDF always saves the document window.
  - Opening a document window requires that document's permission.
  - Navigation is limited to the application itself.
  - The demo build is read-only by an allow-list.
- **Dates.**
  - Financial reports, payment filters, the audit log and the dashboard count by the clinic's local day.
    Before 5.0.0, entries between midnight and 06:00 in Bangladesh could land on the previous day.
  - The collection report prints local times.

## Upgrade notes

- **Upgrading from 4.2.x:**
  - Install over the existing version. The database upgrades on first start, after the safety copy described
    above. No clinical or financial data is rewritten.
  - Print profiles are converted to A4 as described.
- **Review user permissions after upgrading.** Saving a user now stores exactly the permissions shown.
- **Back up before upgrading.** As always, keep a recent backup in a separate location.

## Known limitations

- Physical printing and Electron's Save-as-PDF were not verified on a printer for this release candidate. Every
  document was measured as A4 in generated PDFs. Print a test page set on the clinic printer before relying on
  it.
- Date fields may show mm/dd/yyyy on some Windows locales. Dates are stored correctly either way.
- The minimum window size (1180 × 680) does not fit a 1366 × 768 screen at 125 % scaling.
- Full list: `docs/KNOWN_LIMITATIONS.md`. Audit trail: `docs/audits/v5/`.

## Verification

Tests, CI runs and gate status are in `docs/audits/v5/TEST_RESULTS.md` and `RELEASE_READINESS.md`.
