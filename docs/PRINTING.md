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

## Clinic branding in printed documents

Printed headers show the configured clinic name and logo (see `src/renderer/components/clinic-brand.tsx`), falling back to the product identity and a generic clinic name when nothing is configured. The clinic logo is stored under `<dataDir>/branding/` and is included in `.dpv` backups, so a restored backup keeps printing the clinic's own letterhead.

## Verification still required

Automated unit checks cover print dimensions, format helpers, the real-amount render contract and the absence of a media swap (`tests/unit/print-money.test.ts`). The print-window assertion in `tests/e2e/app.spec.ts` additionally requires that no `****` appears anywhere in the rendered `.print-doc`. Physical printer, PDF content, Bengali glyph shaping, long-page overflow, paper sizes, orientation, DPI/layout and a real print window have **not** been verified in this sandbox, because no Electron/Chromium binary can be downloaded here. Before release, run these checks on a Windows device using disposable patient data. Do not claim successful printer or PDF output solely because the renderer build passes.
