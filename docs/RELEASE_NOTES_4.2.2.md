# Dentiva Pro 4.2.2

Dentiva Pro 4.2.2 is a UI-layout and regression-test hardening release. It includes the responsive invoice/medicine-entry layout updates and prescription print-layout adjustments, plus a correction to the walk-in / quick-documents Electron E2E selector.

## Fixed

- **Walk-in / Quick Documents E2E selector:** the test now targets the editable medicine input inside `.medicine-entry-editor`, rather than the enclosing prescription-medicines section selected by the ambiguous accessible label.
- **Responsive invoice and medicine-entry layouts:** adjust the invoice-line layout and form sizing to wrap more gracefully at narrower viewports.
- **Prescription print layout:** use a flexible print-document layout so the content can grow and the footer can follow the document body.
- **Invoice helper text:** remove redundant helper copy from Main Invoice and Walk-In Invoice.

## Verification

The CI run associated with the selector fix passed:
- Typecheck, lint, unit and integration tests
- Windows Electron end-to-end tests
- NSIS installer build and installed-artifact smoke test

The installer artifact was built by GitHub Actions for the tested commit. A new version-tagged release must still run the tag-gated release workflow before the official installer and SHA-256 checksum can be published.

## Notes

- This release does not intentionally change invoice calculations, payment/ledger behavior, patient records, or database schema.
- Physical printer output, PDF pagination and Bengali glyph rendering should still be checked on the target clinic computer before relying on printed documents for clinical use.
