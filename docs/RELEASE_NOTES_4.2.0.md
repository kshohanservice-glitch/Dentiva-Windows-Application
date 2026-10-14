# Dentiva Pro 4.2.0

Dentiva Pro is an offline, local-first Windows application for dental clinics. This release adds
prescription-entry improvements and an optional clinic-logo watermark while preserving existing
invoice arithmetic and saved clinic data.

## Prescription entry

- The registered-patient and Walk-in / Quick Prescription screens now share the same medicine-entry
  editor, including consistent fields for medicine name, generic name, dosage form, strength,
  dosage, frequency, duration, quantity, and administration note.
- Walk-in prescriptions include common C/C (chief complaint) and O/E (on examination) choices.
  Selecting **Other** allows the clinician to enter their own text; the choices do not restrict
  manual entry.
- Each medicine may have an optional one-line instruction, kept as entered. When supplied, it is
  printed in place of that medicine's structured dosage, frequency, duration, quantity, and
  administration note so the same directions are not duplicated or contradicted. The medicine name,
  strength, and generic information remain available in the printout. In a registered prescription,
  both the optional line and structured values are saved; in Walk-in, the values remain in the
  transient form/payload only. Leaving the optional line blank preserves the structured print format.
- Migration 007 adds a nullable column for the optional instruction. Existing prescription-item
  rows and fields are not rewritten.

## Clearer invoice entry

- Main and Walk-in invoice forms distinguish a **line discount** from the **invoice-wide discount**
  and explain how each is applied.
- Walk-in invoice entry identifies **Amount received now** separately from the invoice total and
  explains that it affects the balance due, not the total.
- The changes are explanatory UI only. Existing invoice calculation, payment, and ledger behavior
  is unchanged.

## Optional clinic-logo watermark

- **Settings → Customize Documents** includes an optional clinic-logo watermark for supported
  document types. It is off by default; disabling it or not having a configured logo leaves the
  document without a watermark.
- The logo is centered in the page's physical document coordinates, keeps its intrinsic aspect
  ratio, and has bounded size and opacity controls. The preview uses the same document renderer as
  printing.
- Watermarks are limited to prescriptions, invoices, visit summaries, appointment cards, and
  reports (including supported Walk-in variants). Compact stock labels and receipts are excluded
  for readability.

## Reliability and accessibility

- Form controls use explicit, consistent labels and accessible names.
- Settings forms refresh from the saved settings after a successful save; removing a logo also
  removes its stale local preview.
- No runtime dependency or network service is added. The application remains offline and
  local-first.

## Upgrade and verification notes

Migration 007 is additive: an existing schema-version-6 clinic database is upgraded by adding a
nullable prescription-item column. The migration leaves existing item data intact. As with other
forward-only schema migrations, make and verify a separate backup before upgrading; an older
application version is not a rollback mechanism for a database after it has advanced to schema 7.

The exact verification outcomes and remaining limitations are recorded in
[`PROGRESS_V4.2.0.md`](PROGRESS_V4.2.0.md) and [`AUDIT_V4.2.0.md`](AUDIT_V4.2.0.md). In particular,
physical-printer output and target-device behavior must not be inferred from unit tests or a
successful build.
