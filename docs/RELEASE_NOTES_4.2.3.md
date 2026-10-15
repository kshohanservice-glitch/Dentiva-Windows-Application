# Dentiva Pro 4.2.3

> **Never released.** This draft was prepared on `main` after `v4.2.2` but no `v4.2.3` tag or
> installer was ever published. Its layout work (including a later revision that made the walk-in
> invoice-line arrangement width-independent) ships in **v4.3.0** — see
> `docs/RELEASE_NOTES_4.3.0.md`. The text below is kept as the record of what was planned and
> measured at that time.

Dentiva Pro 4.2.3 is a responsive-layout release. It fixes the reported Walk-in /
Quick Documents invoice layout defect, repairs the other layout defects found by
a repository-wide responsive audit, and adds automated geometry tests so the
same problems cannot return. No clinical or financial behaviour changed.

## Fixed — Walk-in invoice lines (reported defect)

At narrow panel widths the invoice line put five fields in one row and
`Discount (৳)` / `Line total (৳)` were clipped. The line is now laid out from the
width of the panel that contains it, not from the window:

- **Narrow panel (under 690px):** first row `Item or procedure` · `Qty` ·
  `Unit price (৳)`; second row `Discount (৳)` · `Line total (৳)`.
- **Wide panel:** the compact single row is kept, but only while every field
  actually fits.
- `Remove` stays in the line heading, clear of both rows, with the accessible
  name `Remove invoice line <n>`.
- Labels, validation, keyboard use, currency formatting and the line arithmetic
  are unchanged.

Measured before → after (`npm run layout:audit`, 1366×768 window where the
invoice panel is 450px): grid overflow `+238px` → `0px`, with the required two-row
arrangement at panel widths from 316px to 676px and a single row at 752–858px.

## Fixed — other confirmed responsive defects

- **New invoice dialog (Patients / Invoices):** the five-field line no longer
  overflows the dialog; narrow dialogs show `Description` · `Qty` ·
  `Unit price (৳)` · Remove, with `Line total (৳)` on the second row.
- **Prescription medicine entry:** the medicine card now scales 1 → 2 → 3
  columns with its own width instead of always forcing three columns.
- **Dashboard, About, Reports:** the page splits can shrink
  (`minmax(0, …)` tracks) and stack into one column on narrow windows; they used
  to force horizontal page scrolling (+116px, +182px, +69px at 480px).
- **Patient profile → Overview:** cards reflow into one column and the chart card
  spans the full width; the overview no longer overflows the page (+100px).
- **Settings → Customize documents:** the element list and controls are now
  shrinkable inside their grid (+83px).
- **Walk-in procedure rows (Examination report):** dedicated grid areas; two
  columns on narrow cards, one row when it fits.

Print/PDF output, the printed document template, database schema, migrations and
IPC contracts are untouched: the work is CSS plus layout class hooks.

## Verification

- Typecheck (main + renderer) and ESLint: clean.
- Vitest: **549 tests in 48 files pass**, including 35 layout-regression tests
  (`tests/integration/ui-layout-regressions.test.ts`).
- Responsive harness (`npm run layout:audit`): 18 screens × 6 viewport sizes
  (1920×1080, 1366×768, 1024×768, 800×600, 680×900, 480×800) plus the New-invoice
  dialog, the patient-registration dialog, the Customize-documents tab, every
  Walk-in tab, the patient profile and the print preview — **144/144 clean**
  (4 violations before the fix).
- Windows Electron E2E (`tests/e2e/responsive-layout.spec.ts`): real window
  resized to 1366×768 and 1180×720, three invoice lines with long descriptions
  and 13-digit amounts, add-from-saved-treatment, remove-line, validation,
  keyboard entry and the printed total, all asserted on rendered geometry.
- NSIS installer build and installed-artifact smoke test, then SHA-256 of the
  published installer, run by the tag-gated workflow for this version.

Full audit report: `docs/RESPONSIVE_AUDIT_V4.2.3.md`.

## Assets

- `DentivaPro-Setup-4.2.3.exe` — per-user Windows x64 installer (NSIS).
- `SHA256SUMS.txt` — SHA-256 of the installer above; verify with
  `certutil -hashfile DentivaPro-Setup-4.2.3.exe SHA256` (or
  `sha256sum -c SHA256SUMS.txt`) before installing on a clinic computer.

## Notes

- Clinic data is preserved on upgrade; `deleteAppDataOnUninstall` remains false.
- The supported window minimum is 1180×720. Sizes below that were verified with
  the harness because the print window can be 720px wide.
- Physical printer output, PDF pagination and Bengali glyph rendering should
  still be checked once on the target clinic computer.
