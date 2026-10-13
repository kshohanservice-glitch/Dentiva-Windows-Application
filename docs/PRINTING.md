# Dentiva Pro — printing and PDF (implementation status)

This describes the current print path; see `RELEASE_EXECUTION_JOURNAL.md` for tests and blockers. It is **not** a certification of printer/DPI output.

## Runtime path

The main process opens a sandboxed, context-isolated Electron BrowserWindow at `#print/<kind>/<id>`. The renderer retrieves the document data through authenticated, permission-gated IPC and shows a print preview. Supported routes include invoice, receipt, prescription, visit summary, appointment card, stock labels and reports.

The print toolbar selects a saved profile and offers Print and Save PDF. Profiles contain document type, paper dimensions/orientation, margins, scale, printer name and copies. `PrintPage.tsx` computes the page width/height and inline padding from the selected profile; `@page` uses the same dimensions without a second native margin. `src/main/print.ts` calls Electron's `webContents.print` or `printToPDF` and returns errors/cancellation rather than claiming an unsuccessful export succeeded. For actual supported fields and formats, consult `src/shared/types.ts` (`PrintProfile`) and `src/renderer/pages/PrintPage.tsx`.

## Privacy boundary

Money amounts in the **on-screen** preview are masked `****` by default and can be revealed locally or globally. Print and Save PDF are intentional sensitive-data exports: CSS print media contains the original financial values, not the screen placeholders. Exported files, OS print dialogs, physical pages and report CSV are **not masked** and must be handled as clinic records. The print window closes on lock or logout, and the print IPC requires a live session. Screen and print media differ deliberately here; WYSIWYG claims about sensitive values would be misleading.

## Verification still required

Automated unit checks cover print dimensions/format helpers; Windows Electron E2E includes opening print windows. Physical printer, PDF content, Bengali glyph shaping, long-page overflow, paper sizes, orientation, screen-reader handling of masked amounts and DPI/layout have **not** been verified in this sandbox. Before release, run these checks on a Windows device using disposable patient data. Do not claim successful printer or PDF output solely because the renderer build passes.
