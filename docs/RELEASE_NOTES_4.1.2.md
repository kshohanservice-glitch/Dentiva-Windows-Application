# Dentiva Pro 4.1.2

Released: _published with the tag `v4.1.2`_ · Windows 10/11 (x64) · offline · no cloud dependency

This release adds two long-requested document workflows. Both are **additive**: every existing
document prints exactly as it did in 4.1.1 unless a clinic explicitly changes something, and no
patient, invoice, prescription, payment, visit or appointment record is affected by either feature.

---

## 1. Settings → Customize Documents

Clinics can now adjust the printed design of every document they issue, without a new template
engine and without touching the application screens.

* **Per element, per document.** Seven document types — prescription (and its duplicate copy),
  invoice, payment receipt, visit summary, appointment card, stock & expiry labels and reports —
  are described by a registry of stable element identifiers (`invoice.header.clinicName`,
  `prescription.body.medicationTitle`, `report.tables.totalsValue`, …). Element identity is never
  derived from the text, so a customization keeps applying when the content changes.
* **The controls a clinic expects.** Text colour, font size, weight, family, alignment, line
  height, letter spacing; margin and padding on all four sides; bottom border width/style/colour;
  background; per-column table widths; the clinic-logo size; and the ability to hide the elements
  that are genuinely optional (a language variant of the clinic name, a footer note, a signature
  label). Table header and body cells, totals cells and payment-history cells each have their own
  group.
* **Live preview using the real renderer.** The preview is produced by the same document builders
  the print window uses, with realistic sample content, so what the clinic sees is what it prints.
* **Scoped reset.** Reset a single element, a whole section (header / body / tables / footer), one
  document, or every document.
* **Safe by validation.** Values are validated and clamped on save *and* on read: unknown elements
  and properties are dropped, out-of-range numbers are clamped, colours must be hex, non-optional
  content cannot be hidden, and malformed stored JSON falls back to the original design. Validation
  never throws.
* **Original design preserved.** With nothing customized, the generated stylesheet is empty — not
  blank rules, not overrides that happen to match. `tests/unit/document-layout.test.ts` renders
  every document through the pre-4.1.2 implementation and through the current one and requires the
  markup to be identical.
* **Applies to printing, the print preview and “Save as PDF”**, in the stored-document workflow and
  in the walk-in workflow. It does not change application screens, navigation, forms or the amounts
  and calculations printed on a document.
* **Stored in the existing settings store** under the `documentStyles` key — no database migration,
  and a 4.1.1 database opens unchanged. Customizations travel in `.dpv` backups like every other
  setting.

## 2. Walk-in / Quick Documents

A new sidebar entry (**Walk-in / Quick Docs**) prints a document for a one-time customer without
registering a patient.

* **Five documents:** quick prescription, quick invoice, quick receipt, quick examination report
  (visit summary) and quick appointment card.
* **Same templates, same arithmetic.** The documents are rendered by the same builders as stored
  documents — including the clinic letterhead, dentist credentials, footer, signature block and
  page geometry. Invoice totals use the same integer-exact calculation as the Invoices page.
* **Nothing is written to a patient record.** The payload is validated in the main process, held in
  memory only (two hours, at most 24 documents, oldest evicted first) and discarded when the app
  closes. No patient, invoice, prescription, payment, visit or appointment row is created — verified
  by test — so drafts can never pollute the patient table or the accounts.
* **Preview, print and Save as PDF** use the existing print window. A quick document is clearly
  marked as such on the page and in the suggested PDF file name (`QP-…`, `QI-…`, `QR-…`, `QV-…`,
  `QA-…`), and its reference format can never collide with the `INV-YYYY-NNNNN` invoice series.
* **No WhatsApp, anywhere in this workflow.** No WhatsApp button, message generation, contact
  launch, suggested message, link or automatic action exists on this screen; a source-level test
  enforces it. WhatsApp on the patient screens is untouched and behaves exactly as before.
* **Permission-gated in the service, not just the UI.** Each kind requires its real create
  permission *and* its print permission; without them the document cannot be prepared or read.
* Honest limits, stated in the screen copy: a quick document is not recorded in the books, not
  added to the schedule and not kept in a patient history. Register the patient (or use the Invoices
  / Appointments pages) when the clinic must keep a record.

## 3. Audit, hardening and correctness work

* Document renderers were extracted from the print page into a single rendering module that the
  print window, the customization preview and the walk-in workflow all use — one template, one set
  of calculations, no forked layouts.
* Invoice arithmetic now lives in one shared integer-paisa module used by both the stored-invoice
  service and the walk-in invoice, so equivalent invoices cannot drift apart.
* The print window now denies window-open and blocks navigation away from `file://`, matching the
  main window's hardening.
* Fixes recorded in `docs/AUDIT_V4.1.2.md`: per-declaration `!important` in the generated
  stylesheet (clinic choices actually won), visibility offered for every optional element, a quick
  prescription that names a deleted dentist is refused instead of printing an unsigned prescriber,
  and the print-masking contract test was re-pointed at the module that actually renders.
* 93 tests added (unit, integration and a frozen-baseline layout regression). Full suite:
  **42 files / 468 tests, all passing.** Typecheck, lint, production build and the production
  dependency audit (`npm audit --omit=dev`) are clean. No new runtime dependency was added and no
  paid or cloud service was introduced.

## 4. Upgrade notes

* No database migration and no data transformation. Opening an existing installation updates nothing
  but the application version.
* No document prints differently after the upgrade. Open **Settings → Customize Documents** to make
  a change, and use the reset buttons (element / section / document / all) to return to the original
  design at any time.
* Uninstalling does not remove clinic data (unchanged behaviour).

## 5. Verification status for this release

Automated, executed for this exact commit: unit + integration suite (468 tests), both TypeScript
projects, ESLint, production dependency audit, production build, and the tag-gated Windows CI jobs
(Electron E2E on Windows, NSIS installer build, silent install + installed-application smoke test,
SHA-256 checksums). The build artefacts attached to the release page are the ones produced by that
verified pipeline; see the release page for the installer name and checksum.

Not verifiable in the development sandbox and therefore **not** claimed here: physical printer
output, DPI/paper behaviour with a clinic's own customization, and Bengali glyph shaping on paper.
Those require a Windows machine and a printer; the customization ranges are bounded and the layout
regression suite guards the default design, but a clinic should print one sample of each customized
document before relying on it.
