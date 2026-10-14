# Dentiva Pro 4.2.1

Dentiva Pro is an offline, local-first Windows application for dental clinics. 4.2.1 is a hardening
release on top of 4.2.0: it fixes three defects found while auditing the 4.2.0 implementation, adds a
label-policy regression gate, and adds the missing *reset* control for the clinic-logo watermark. No
calculation, schema, stored-record or document-format change is included, so existing clinic data
prints exactly as before.

## Fixed

- **The clinic-logo watermark is now actually visible.** In 4.2.0 the watermark layer was painted at
  `z-index: -1`, which placed it *behind* the white page backgrounds of the print stage and the page
  box. The mark was therefore invisible both in the preview and on paper, even though the setting
  reported "Enabled". The mark now paints above those background layers, and the document body is
  wrapped in a dedicated content layer (`.print-doc-content`) that keeps every line of patient text on
  top of the logo. Unchanged: the watermark stays off by default, is centered in the page's physical
  coordinates, repeats page-centered on every sheet, never distorts the logo, and is still excluded
  from receipts and stock/expiry labels.
- **Corrupt or hand-edited watermark settings no longer become the smallest mark.** A missing, blank or
  non-numeric `sizePercent`/`opacity` (for example `null`, `""`, a string, or an object) was read as
  zero and then clamped *up* to the minimum watermark. Such values now fall back to the documented
  default (40 % size, 0.12 opacity); real numbers outside the supported window are still clamped.
- **The per-treatment quantity field in the visit form is now labelled.** It carried neither a visible
  label nor an accessible name, so it could not be identified by a screen reader or by a
  label-based test; it is now named “Quantity of <treatment>”.
- **Removed dead stylesheet code** (the `.line-editor` grid left behind when both prescription modules
  moved to the shared labelled medicine editor). No visual change.

## Added

- **Label-policy regression test** (`tests/unit/form-label-policy.test.ts`): fails the build if any
  shared `Input`/`Select`/`Textarea` in the renderer ships without a visible label or an explicit
  accessible name, or if CSS hides a field label. Toolbar filters and search boxes intentionally keep
  an accessible-name-only contract; those are listed in `docs/KNOWN_LIMITATIONS.md`.
- **“Reset watermark”** in Settings → Customize Documents, which restores the disabled default (size
  40 %, opacity 0.12) without touching any other customization.
- **Restored test depth** for the 4.2.0 features, inside the existing test files: watermark settings
  normalization edges, page-box geometry, the stylesheet layering contract and the rendered preview
  composition; the frozen C/C and O/E option lists (values, uniqueness, single “Other”, round-trip
  decoding); the walk-in one-line instruction bound (blank → no value, 501 characters rejected, exact
  text preserved per medicine); and instruction/watermark service rules (blank → `NULL`, over-long
  rejected without writing a row, permission enforced, watermark round-trip, clamping, corrupt stored
  JSON → defaults, and other settings left untouched).

## Documentation

- `docs/KNOWN_LIMITATIONS.md` — what is labelled and what is accessible-name-only, the exact print
  semantics of the optional one-line medicine instruction, the watermark's supported windows and the
  behaviour that remains unverified on real paper.
- `docs/PRINTING.md` — a new “Clinic-logo watermark” section describing the model, eligibility
  allow-list, geometry, layering contract and degradation rules.
- `docs/AGENT_PROGRESS.md` — the audit trail for this release, including the defects above.

## Compatibility and upgrade

- No new migration. The schema stays at version 7 (the nullable `prescription_items.medicine_instruction`
  column introduced in 4.2.0). Opening an existing database performs no data rewrite.
- No change to invoice arithmetic, payment/ledger behaviour, prescription storage, templates, settings
  keys or document formats. Watermark settings default to disabled, so an installation that never
  enabled the watermark prints byte-identical documents.

## Verification

- Verified on Windows CI (`windows-latest`) for the tagged commit: typecheck, lint, unit + integration
  tests, the Playwright Electron end-to-end suite, and the NSIS installer with an installed-artifact
  smoke test. The installer and its SHA-256 checksum are the assets attached to this release.
- **Not verified in the build environment** (no printer or display, Linux container): physical printer
  output, PDF page content, on-paper watermark centering/repetition and Bengali glyph shaping. The
  watermark's geometry is computed from the real page size in millimetres and the layering is asserted
  from the stylesheet, but please print one document on your own printer before relying on it for a
  batch.
