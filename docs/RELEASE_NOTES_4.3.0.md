> **Superseded.** Version 4.3.0 was never released. Its work (A4-only printing, walk-in invoice layout)
> ships in **5.0.0** — see `docs/RELEASE_NOTES_5.0.0.md` and `docs/V5_PROGRESS.md`.

# Dentiva Pro 4.3.0

Dentiva Pro 4.3.0 is a printing-policy and layout release. Printed documents are now **A4 only** — the
saved per-document print profiles can no longer carry a page size, only orientation, printer, margins,
scale and copies — and the reported Walk-in / Quick Documents invoice-line defect is fixed with a
width-independent two-row arrangement. No patient, clinical or financial behaviour changed.

## Changed — A4-only document printing

- **One document size.** Every printable document (prescription, prescription duplicate, invoice,
  receipt, visit summary / treatment plan, appointment card, report, stock/expiry labels and the five
  Walk-in / Quick documents) is laid out on A4 — 210 × 297 mm — portrait or **landscape** (297 × 210 mm)
  per profile. There is no A5, Letter, Legal, thermal-roll or custom page size anywhere in the product.
- **Profiles describe how, not how big.** A print profile keeps its name, document type, printer,
  orientation, margins, scale and copies; the page-size fields (`paperSize`, `widthMm`, `heightMm`) are
  gone from the stored model, the settings API and the print window. Profile margins are document
  padding inside the A4 sheet (0–50 mm), never a second `@page` margin.
- **Upgrade is automatic and non-destructive.** Database migration 8 (`a4-only-printing`, schema
  version 8) rewrites the stored `printProfiles`: A4 profiles are kept verbatim — printer, orientation,
  margins, scale and copies survive — page-size keys are stripped, and any document type left without a
  profile is re-seeded with its A4 default (`Prescription A4`, `Invoice A4`, `Receipt A4`,
  `Report A4`). The migration is idempotent, writes one append-only audit entry, and does not touch
  patient, clinical or financial rows. Legacy profiles that cannot be mapped to A4 are removed; a later
  save that omits an extra profile is the only way to drop one, and the four document types always keep
  an A4 profile (the settings interface edits orientation, scale and copies only).
- **Settings.** The print-profile table shows a static `A4 · 210 × 297 mm` size column; the page-size
  picker is gone.
- **Enforced at the boundary.** The main-process print and Save-as-PDF calls resolve the page box they
  are given through the shared A4 helper, so a stale or tampered renderer cannot print or export an
  A5/thermal/Letter page: a non-A4 request becomes A4 portrait. A source-level test fails if either
  print path stops using that helper.
- **WYSIWYG unchanged in spirit and stricter in fact.** The preview page, `@page size` rule, the
  main-process print call and the Save-as-PDF call all use the same A4 box and the same orientation, so
  what is on screen is the sheet that is printed.

## Fixed — Walk-in / Quick Documents invoice line (reported defect)

The invoice line put five fields in one fixed row whose columns needed ≈690 px, while the panel that
contains it is 450–630 px wide in every supported window (1180×720 and above); `Discount (৳)` and
`Line total (৳)` were clipped and pushed outside the card.

- The line is now one grid at every width: row 1 `Item or procedure` · `Qty` · `Unit price (৳)`,
  row 2 `Discount (৳)` · `Line total (৳)`. No width-dependent alternative arrangement exists.
- `Remove` stays in the line heading (`Remove invoice line <n>`), clear of both rows.
- Labels, validation, keyboard use, currency formatting and the line arithmetic are unchanged.
- Measured with the responsive harness (`npm run layout:audit`, the same probe the repository uses
  for layout gates) on three builds:

  | Build | 1180×720 (minimum window) | 1366×768 | 1920×1080 / 2560×1440 | Violations |
  | --- | --- | --- | --- | --- |
  | `v4.2.2` (published baseline) | panel 714px, +0 (window below its minimum) | grid overflow **+238px**, `Discount (৳)`/`Line total (৳)` outside the card | grid **+85px**, `Line total (৳)` outside the card | **18** |
  | `v4.2.3` (published) | one row of five fields — not the required arrangement | two rows, 0 overflow | two rows, 0 overflow | **1** (arrangement) |
  | this release | two rows, 0 overflow | two rows, 0 overflow | two rows, 0 overflow | **0** |

  No field is outside its card and no money value is clipped on this build (measured, and enforced by
  the harness, at every size from 480×800 to 2560×1440).
- The same fixed-template cause was repaired in the other surfaces the audit found: the five-field line
  in the New invoice dialog, the prescription medicine entry (1 → 2 → 3 columns from its own width),
  Dashboard/About/Reports splits, the patient profile overview, Settings → Customize documents and the
  Walk-in procedure rows. See `docs/RESPONSIVE_AUDIT_V4.2.3.md` for the audit itself.

## Verification for this version

- Typecheck (main + renderer), ESLint and `npm run build`: clean.
- Vitest: **572 tests in 50 files pass**, including the 37 layout-contract tests
  (`tests/integration/ui-layout-regressions.test.ts`), the 13-test A4-only policy suite
  (`tests/integration/a4-only-printing.test.ts`: source gate, fresh-install defaults, upgrade migration,
  legacy-profile detection, write-path rejection, main-process boundary enforcement) and a 6-test upgrade suite that runs the migration on
  a database written by the **real v4.2.2 code** (`tests/fixtures/v4.2.2/dentiva-v4.2.2.db`, rebuilt by
  `scripts/build-v422-fixture.mjs`): patients, appointments, visits, prescriptions (including the
  v4.2.2 medicine instruction), invoices and payments are untouched, the A4 profiles survive with their
  setup, the retired A5/thermal/custom mediums are replaced by the A4 profile for their document type,
  the outcome is audited, and the reopen is idempotent.
- Responsive harness (`npm run layout:audit`): **0 violations of 192** screen/viewport pairs
  (24 screens × 8 sizes, 2560×1440 → 480×800) and 0 walk-in-invoice violations.
- Print/PDF geometry audit (`npm run layout:audit -- --pdf`): **0 violations in 13 printable documents
  plus 3 landscape views** — every document measured 210×297 mm on screen with a 209.9×297 mm PDF page
  box, 1 page, 12/12 mm padding; landscape views measured 297×210 mm with 297×209.9 mm PDF pages.
- Windows gates run on the GitHub Actions Windows runner for the head of PR
  [#42](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/42) — the dependency
  audit, typecheck, lint, Vitest, build (`verify`) and the real Electron end-to-end suite are green on
  the candidate; the NSIS installer build, silent install, installed smoke test and installer SHA-256
  (`package`) follow in the same workflow. They cannot run in the Linux authoring sandbox.

### Not verified here

Physical printer output, paper handling, on-paper watermark centering/repetition, Bengali glyph shaping,
installed DPI, and a real Electron Save-as-PDF/print dialog on a Windows device. The geometry audit
above drives the production renderer bundle in a plain Chromium over HTTP — it is evidence about the
page box and the PDF `/MediaBox`, not about a printer driver. Check these once on the target clinic
computer before relying on printed documents for clinical use.

## Migration and data

- Clinic data is preserved on upgrade; `deleteAppDataOnUninstall` remains `false`.
- Schema version 8. Migration 8 is forward-only and idempotent; take a backup before upgrading a real
  clinic (Settings → Backup, or `.dpv` export) as with any release.
- The supported window minimum is 1180×720.

## Assets

- `DentivaPro-Setup-4.3.0.exe` — per-user Windows x64 installer (NSIS).
- `SHA256SUMS.txt` — SHA-256 of the installer above; verify with
  `certutil -hashfile DentivaPro-Setup-4.3.0.exe SHA256` (or `sha256sum -c SHA256SUMS.txt`) before
  installing on a clinic computer.

## Notes

- `v4.2.3` (released 2026-10-15) already removed the *overflow* of this line, but it kept a
  width-dependent alternative and therefore showed **one row of five fields** whenever the panel was
  wide enough — which is the case at the application's minimum window size 1180×720 (panel 832px).
  The required two-row arrangement is the only arrangement from 4.3.0 on.
- Detailed progress, measurements and open gates: `docs/PROGRESS_V4.3.0.md`.
- Printing policy and document geometry: `docs/PRINTING.md`. Database changes: `docs/DATABASE.md`.
