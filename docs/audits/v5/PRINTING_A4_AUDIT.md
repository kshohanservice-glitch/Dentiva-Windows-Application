# Dentiva Pro v5 — A4 printing audit

**Date:** 2026-10-15 · **Branch:** `arena/8ba688c2-dentiva-windows-application` · **Renderer audited:** the
bundle built from the branch head of 2026-10-15 (commits up to `dc1534b`).

**Verdict:**
- **Gate E (A4) — PARTIAL.** Every printable document is A4 in the data → template → preview → PDF chain, measured
  in Chromium 153.
- Electron's own print and `printToPDF` paths were not measured. The Windows E2E suite opens the print window and
  checks its content, but not the paper geometry.
- No physical printer was available, so physical output is **unverified**. Do not claim printer output from this
  document.

## 1. Rules applied

- **Page sizes:** A4 only. Portrait is 210 × 297 mm and landscape is 297 × 210 mm. Units: 96 CSS px per inch and
  25.4 mm per inch (1 mm = 3.7795 px).
- **Removed sizes:** no A5, Letter, Legal, thermal-roll or custom sizes in any active UI, logic, validation,
  profile, preview, PDF or print path.
- **Migrations:** historical migrations are untouched. Migration 008 converts legacy profiles; see §4.
- **Multi-page output:** allowed where the content needs it. Margins apply on every sheet.

## 2. Enforcement points (single source of truth)

| Layer | Mechanism | Test |
| --- | --- | --- |
| Shared model | `src/shared/print-page.ts`: `A4`, `asA4PageSize()`, `planPrintProfiles()`, geometry-only legacy detection (`isLegacyNonA4Profile`), `withRequiredProfiles()` (collision-safe ids) | `tests/unit/print.test.ts`, `tests/integration/a4-only-printing.test.ts` |
| Settings write path | `services/settings.ts`: profiles are normalised to A4; there is no paper field | a4-only-printing (write-path rejection) |
| Main process | `print.ts` `executePrint()` / `saveAsPdf()` pass every size through `asA4PageSize()`. A tampered A5 or thermal request becomes A4 portrait. Save-as-PDF always exports the print window (V5-005) | a4-only-printing (source gate), access-policy |
| Print window | Opening a window requires the document's permission (V5-010). Navigation is limited to the packaged `index.html` (V5-004) | access-policy.test |
| CSS | `@page { size: A4 portrait \| landscape; margin: 0 }`. Profile margins are document padding, repeated on every sheet (V5-026) | v5-print-chain, a4-only-printing (no non-A4 `@page`) |
| Source gate | Fails if a `paperSize` field, a retired page-size literal, a non-A4 `@page` or a non-A4 millimetre constant appears in `src/` | a4-only-printing |

## 3. Documents (chain evidence)

**Columns:**
- **Permission** is checked by the main process before the print window opens. Quick documents use
  `quick-documents/prepare`, which checks the create and print permissions.
- **Template** names the `src/renderer/documents/print-documents.tsx` component. Its markup is frozen by
  `tests/unit/document-layout.test.ts`.
- **Screen box** is the measured `.print-doc` box in the print window.
- **PDF** is the `/MediaBox` of a PDF printed with `preferCSSPageSize`, which is the rule Electron's `printToPDF`
  honours.
- **Pages** compares the normal fixture with the `--long` fixture (70 invoice lines, 30 medicines, 150 report
  rows).

| Document | Permission | Screen box | PDF (mm) | Pages normal / long | ৳ glyph source | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Invoice | `billing.invoice.view` | 210 × 297 | 209.9 × 297 | 1 / 5 | NotoSansBengali (embedded) | A4 ✔ |
| Receipt | invoice + payment view | 210 × 297 | 209.9 × 297 | 1 / 1 | NotoSansBengali | A4 ✔ |
| Prescription | `clinical.view` | 210 × 297 | 209.9 × 297 | 1 / 2 | — (no amounts) | A4 ✔ |
| Prescription duplicate (watermark) | `clinical.view` | 210 × 297 | 209.9 × 297 | 1 / 2 | — | A4 ✔ |
| Visit summary | `clinical.view` | 210 × 297 | 209.9 × 297 | 1 / 1 | NotoSansBengali | A4 ✔ |
| Appointment card | `appointments.view` | 210 × 297 | 209.9 × 297 | 1 / 1 | — | A4 ✔ |
| Stock and expiry labels | `inventory.view` | 210 × 297 | 209.9 × 297 | 1 / 1 | — | A4 ✔ |
| Report (any of 14) | that report's permission | 210 × 297 | 209.9 × 297 | 1 / 5 | — | A4 ✔ |
| Quick prescription | create + print | 210 × 297 | 209.9 × 297 | 1 / 1 | — | A4 ✔ |
| Quick invoice | create + print | 210 × 297 | 209.9 × 297 | 1 / 1 | NotoSansBengali | A4 ✔ |
| Quick receipt | create + print | 210 × 297 | 209.9 × 297 | 1 / 1 | NotoSansBengali | A4 ✔ |
| Quick visit summary | create + print | 210 × 297 | 209.9 × 297 | 1 / 1 | NotoSansBengali | A4 ✔ |
| Quick appointment card | create + print | 210 × 297 | 209.9 × 297 | 1 / 1 | — | A4 ✔ |
| Invoice, landscape | as above | 297 × 210 | 297 × 209.9 | 1 / 5 | NotoSansBengali | A4 ✔ |
| Prescription, landscape | as above | 297 × 210 | 297 × 209.9 | 2 / 3 | — | A4 ✔ |
| Report, landscape | as above | 297 × 210 | 297 × 209.9 | 1 / 7 | — | A4 ✔ |

**How to read these numbers:**
- 209.9 mm is a PDF point-rounding effect: 595 pt = 209.9 mm. The tolerance is ±2 pt.
- All 16 PDFs contain 0 replacement characters (U+FFFD).
- The landscape prescription needs 2 sheets even with the normal fixture. Page 1 now fills to 192.5 mm. Before
  v5, page 1 ended at 64.6 mm and the whole body moved to page 2.
- Both appointment cards print the time in one style on every PC, for example 02:30 PM (V5-033). It used to
  follow the PC's language settings. In the audit of `b40da3a` the PDF text reads 10:00 AM (appointment card)
  and 05:30 PM (walk-in card). Geometry and page counts are unchanged.

**Long fixtures, PyMuPDF checks (after the fixes):**
- **Completeness:** all 70 invoice lines, 150 report rows and 28 numbered medicines (3–30) are present, each
  exactly once, in portrait and landscape.
- **Totals:** invoice totals and the report net total are printed.
- **Margins:** first sheets keep the profile margin (12 mm). Continuation sheets keep ≥ 13.5 mm at the top and
  ≥ 15 mm at the bottom, and ≥ 12 mm left and right.
- **Stranded headings:** none in 32 PDFs (16 normal plus 16 long).

**Chain stages and evidence:**

| Stage | Evidence | Status |
| --- | --- | --- |
| Data | Service tests: billing, prescriptions, reports, quick documents, v5-local-dates | ✔ automated |
| Template | document-layout (frozen markup), print-money (real amounts, no `****`), v5-print-chain (report totals, pagination rules, fonts) | ✔ automated |
| Preview | Harness print window: screen box measured for every document | ✔ Chromium |
| PDF | Harness PDFs (Chromium `page.pdf`, `preferCSSPageSize`) parsed with PyMuPDF | ✔ Chromium, **not** Electron `printToPDF` |
| Print window in Electron | Windows E2E opens prescription and invoice print windows and asserts content (no `****`) | ✔ Windows CI (content, not geometry) |
| Printer | — | ✘ **not verified** (no Windows device or printer) |

## 4. Legacy profiles (migration 008, decision D-6)

| Stored profile | Result |
| --- | --- |
| A4 | Kept unchanged |
| Untouched factory seed (`rx-a5`, `inv-thermal`) | Dropped; the A4 profile of that document type remains |
| Customised page-like medium (A5, Letter, custom ≥ 120 mm) | Converted to A4. Printer, orientation, margins, scale and copies are kept. Named "… A4 (converted)" |
| Customised roll medium (thermal or < 120 mm) | Converted to A4. Copies and orientation are kept. Printer is cleared and margins and scale are reset, because they described another device |

**Guarantees:**
- Ids are cleaned and unique, and never take the built-in `rx-a4`, `inv-a4`, `rc-a4` or `rp-a4`.
- A profile name never triggers a change; detection uses stored geometry only (V5-023).
- One audit row stores the full pre-conversion profiles in `before_json`.
- Tests: `a4-only-printing` (fixtures, a real v4.2.2 database and an idempotent re-run) and `migration-v422`.

## 5. Findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| V5-020 | P1 | Non-A4 page sizes active (A5, custom, thermal) | verified |
| V5-021 | P2 | Harness print-preview probe measured an error card | verified |
| V5-022 | P2 | PR #42 migration deleted customised profiles | verified (converted instead) |
| V5-023 | P2 | Name-based legacy detection could delete a real A4 profile | verified |
| V5-024 | P3 | Harness stub prescriptions had no medicines | verified |
| V5-025 | P2 | ৳ printed as a missing glyph in monospace money stacks | verified |
| V5-026 | P2 | Continuation sheets 1.6–2.6 mm from the edge; page 1 left ~227 mm blank | verified |
| V5-027 | P2 | Printed reports showed an empty "Total" row | verified |
| V5-028 | P3 | Heading stranded at the bottom of a sheet | verified |

**Observations (not changed):**
- Printed invoice status is lowercase ("unpaid"). The printed markup is frozen (decision D-10) and the screen
  shows "Unpaid".
- Monospace and serif fallbacks resolve to OS fonts (DejaVu in this sandbox; Consolas or Cambria-class fonts on
  Windows).

## 6. Still required before release (device checks)

Use disposable data on a Windows PC with the clinic's printer:
- Print each document type, portrait and landscape.
- Print a long invoice, prescription and report.
- Use Electron Save-as-PDF.
- Measure margins on paper and confirm nothing falls in the printer's unprintable border.
- Check ৳ and Bengali text on paper.
- Check the watermark position.
- Check driver scaling ("Actual size" versus "Fit").

## 7. Reproduce

```bash
npm run build:renderer
export LAYOUT_BROWSER=/path/to/chromium   # LAYOUT_BROWSER_LIBS if needed
node scripts/layout-audit.mjs --pdf out/pdf            # 13 documents + 3 landscape views
node scripts/layout-audit.mjs --pdf out/pdf-long --long
```
