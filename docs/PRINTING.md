# Dentiva Pro — printing and PDF (implementation status)

This describes the current print path; see `RELEASE_EXECUTION_JOURNAL.md` for tests and blockers. It is **not** a certification of printer/DPI output.

## Runtime path

The main process opens a sandboxed, context-isolated Electron BrowserWindow at `#print/<kind>/<id>`. The renderer retrieves the document data through authenticated, permission-gated IPC and shows a print preview. Supported routes include invoice, receipt, prescription, visit summary, appointment card, stock labels and reports.

The print toolbar selects a saved profile and offers Print and Save PDF. Profiles contain document type, paper dimensions/orientation, margins, scale, printer name and copies. `PrintPage.tsx` computes the page width/height and inline padding from the selected profile; `@page` uses the same dimensions without a second native margin. `src/main/print.ts` calls Electron's `webContents.print` or `printToPDF` and returns errors/cancellation rather than claiming an unsuccessful export succeeded. For actual supported fields and formats, consult `src/shared/types.ts` (`PrintProfile`) and `src/renderer/pages/PrintPage.tsx`.

The whole printable document tree is reachable only from that authenticated, permission-checked print window, and the window closes on lock or logout.

## Privacy boundary

**Financial masking never reaches a printed, previewed or saved document.**

Money masking is a *screen-only* privacy aid. It is applied by `<Money>` / `<FormattedMoney>` in the normal application UI, where an operator may want to shield amounts from anyone looking over their shoulder. The moment a document becomes an artefact — the print preview, a saved PDF, a physical page or a report CSV — the real, correctly formatted amount is shown, because a financial document that renders `****` is not a financial document.

The mechanism is a single source of truth rather than a media swap:

- `src/renderer/components/print-money.tsx` exports `PrintMoney`, which renders the amount with the shared integer-exact `formatBdt` and a single `.print-money` span.
- `FormattedMoney`'s printable branch renders the same real amount through the same component.
- `src/renderer/styles/print.css` contains one `.print-money` rule with **no** `@media print` / `@media screen` pair, so the preview on screen and the bytes written to the PDF are the same markup.
- `PrintPage.tsx` contains no reveal toggle: there is nothing to reveal, and no way for a caller to ask for a masked export.

Consequently the preview is genuinely WYSIWYG, and `****` cannot leak into a printed or exported document — there is no masked node to leak. The trade-off is deliberate and unchanged from earlier releases: **exported files, OS print dialogs, print spoolers, physical pages and report CSVs are unmasked and must be handled as clinic records.** Keep them secure. See `docs/SECURITY.md`.

Screen masking itself is untouched: no global setting is mutated, no authorisation check is weakened, and the per-amount/global reveal controls in the normal UI behave exactly as before.

## Document customization (Settings → Customize Documents)

Printable documents can be adjusted per element without changing the base stylesheet. The original
design is the source of truth: a document prints exactly as before until a clinic stores an
override, and resetting an element/section/document restores the original.

* Registry: `src/shared/document-styles.ts` declares, for each of the seven document types, the
  stable element ids (`<document>.<section>.<element>`), which properties each element accepts, its
  bounds and whether it may be hidden.
* Markers: a renderer node that may be customized carries `{...docEl('invoice.body.title')}`, which
  adds the attribute `data-doc-el` — no element, no class, no inline style.
* Generated CSS: `documentStyleCss()` emits `.print-doc [data-doc-el="…"] { … }` rules (plus a
  ` th`/` td` descendant for cell groups) **only** for stored overrides, each declaration carrying
  its own `!important`. With nothing customized it returns an empty string, and the print page then
  renders no `<style>` element at all.
* Storage: the `documentStyles` key in the existing settings table, validated on save and on read by
  `normalizeDocumentStyles()` (unknown documents/elements/properties dropped, numbers clamped,
  colours must be hex, non-optional content cannot be hidden, never throws). No migration.
* Preview: `src/renderer/components/customize-documents.tsx` renders a real document (see
  `src/renderer/documents/document-preview.tsx` and `documents/samples.ts`) inside a `.print-doc`
  frame, so the preview and the printed page come from the same builders.
* Geometry is untouched by customization: page size, margins, scale and copies remain owned by
  `profilePageCss()` and the selected print profile.

## Walk-in / Quick Documents

`src/renderer/pages/QuickDocuments.tsx` (sidebar: **Walk-in / Quick Docs**) produces a prescription,
invoice, receipt, examination report or appointment card for a customer who is not registered.

* The form validates with `validateQuickDocumentInput()` (`src/shared/quick-documents.ts`) before
  anything is sent, and the main process validates the same payload again in
  `src/main/services/quick-documents.ts`; the renderer is never trusted.
* Both the create and the print permission of the document kind are required in the service layer.
* The validated payload is held in memory (two hours, at most 24 documents) and is read back by the
  print window through `quick-documents/payload`; it is rendered by the same builders as a stored
  document, so the template, header, footer, signature block and page geometry are identical.
* No patient/invoice/payment/visit/appointment row is written at any point; only an audit entry
  (`document.quick.prepare`) recording the kind and reference.
* There is no WhatsApp surface in this workflow (enforced by a source-level test); WhatsApp on the
  patient screens is unchanged.

## Clinic branding in printed documents

Printed headers show the configured clinic name and logo (see `src/renderer/components/clinic-brand.tsx`), falling back to the product identity and a generic clinic name when nothing is configured. The clinic logo is stored under `<dataDir>/branding/` and is included in `.dpv` backups, so a restored backup keeps printing the clinic's own letterhead.

## Clinic-logo watermark (Settings → Customize Documents)

An optional page-centered clinic-logo watermark, off by default.

* `src/shared/document-watermark.ts` owns the model: `DEFAULT_DOCUMENT_WATERMARK`
  (`{ enabled: false, sizePercent: 40, opacity: 0.12 }`), the supported windows (size 15–70 % of the
  page's shorter edge, opacity 0.04–0.3) and `normalizeDocumentWatermark()`, which is applied on the
  way in **and** on the way out of the settings service, so a hand-edited or half-migrated
  `documentWatermark` row can never break rendering. A missing, blank or non-numeric field falls back
  to the documented default — it is not treated as zero.
* Eligibility is an allow-list (`supportsLogoWatermark`): prescriptions (including the watermarked
  duplicate copy), invoices, visit summaries, appointment cards and reports. Receipts and stock/expiry
  labels are excluded so nothing is printed on a label that has no space for it.
* Geometry comes from the document's own print profile (paper size, custom millimetre size and
  orientation) via `pageSizeFromProfile()` / `pageSizeForDocument()`, and the mark is drawn as a
  physical-millimetre box: `.print-logo-watermark` is `position: absolute; inset: 0` inside the page box
  with flex centering, and `position: fixed; inset: 0` in `@media print` so a document that flows onto
  a second sheet repeats the mark page-centered on every sheet.
* **Layering:** the mark paints at `z-index: 0` — above the white page backgrounds of `.print-stage` /
  `.print-doc` — and the document body is wrapped in `.print-doc-content` (`position: relative;
  z-index: 1`) so patient text always stays on top of the logo. A negative `z-index` here would put the
  mark *behind* those white backgrounds and make it invisible on screen and on paper;
  `tests/unit/document-watermark.test.ts` asserts the layering rules directly from the stylesheet.
* The image sets no `width`/`height` attributes: both axes are capped with `max-width`/`max-height` plus
  `object-fit: contain`, so the logo keeps its aspect ratio and can never be stretched or cropped.
* Degradation is silent and safe: no logo, the feature off, or a document type outside the allow-list
  renders **nothing at all** (not an empty box, not a broken image). An untouched installation emits no
  customization stylesheet and prints exactly as before.
* The panel shows a live preview rendered by the real document builder (`DocumentPreview` with
  `watermark={…}`), names the size/opacity sliders with the shared `Field` labels, and offers
  **Reset watermark** (back to disabled/default) next to the normal Settings save.

## Verification still required

Automated unit checks cover print dimensions, format helpers, the real-amount render contract, the absence of a media swap (`tests/unit/print-money.test.ts`) and the watermark's settings normalization, page geometry, layering and rendered markup (`tests/unit/document-watermark.test.ts`). The print-window assertion in `tests/e2e/app.spec.ts` additionally requires that no `****` appears anywhere in the rendered `.print-doc`. Physical printer, PDF content, on-paper watermark centering/repetition, Bengali glyph shaping, long-page overflow, paper sizes, orientation, DPI/layout and a real print window have **not** been verified in this sandbox, because no Electron/Chromium binary can be downloaded here. Before release, run these checks on a Windows device using disposable patient data. Do not claim successful printer or PDF output solely because the renderer build passes.
