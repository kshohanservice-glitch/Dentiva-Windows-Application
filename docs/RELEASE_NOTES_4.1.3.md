# Dentiva Pro 4.1.3

Released: _published with the tag `v4.1.3`_ · Windows 10/11 (x64) · offline · no cloud dependency

This release is about **clarity and consistency in the screens staff use all day**, plus one new
optional document feature. Everything is additive: an installation that changes no setting prints the
same documents it printed in 4.1.2, and no patient, visit, prescription, invoice, payment or
appointment record changes meaning.

---

## 1. Clear labels and explanations instead of guesswork

* **The Walk-in / Quick Documents medicine rows were the worst offender.** Each row was a nine-column
  grid of placeholder-only inputs about 116 px wide, so a column could show a clipped fragment of a
  hint (`F…`, `3…`) with no label at all. Both prescription workflows now use the same labelled row
  editor: **Medicine name · Dosage form · Strength · Generic name · Dosage per dose · Frequency ·
  Duration · Quantity to dispense · Instruction for this medicine**, each with a visible label, a
  plain-language hint and a correctly sized field.
* **Prescription patient picker.** The label above the patient search box was no longer associated
  with the input (no `for`/`id` pair); it is now a real labelled field with a hint telling staff to
  type at least two characters and choose the match.
* **Search boxes and filter dropdowns** across Patients, Prescriptions, Invoices, Payments, Inventory,
  Staff, Treatments, Users, Audit and Appointments now carry an accessible name, so a screen reader
  announces “Search invoices”, “Filter by payment status” and so on instead of an unnamed control.
* **The application lock screen** asks for the password with a visible label, not only a placeholder.
* **Dosage forms and frequencies explain themselves.** The form dropdown offers `Tab — tablet`,
  `Cap — capsule`, … and stores the short clinical abbreviation that prints; frequency hints show the
  Bangladesh-style `1+0+1` notation next to “thrice daily”.
* **Invoice fields say what they mean.** The Main invoice line is labelled **Treatment / service**,
  **Quantity** (“how many units were charged”), **Unit price (৳)** (“price of one unit”) and
  **Line total (৳)** (“calculated, not editable”), with “Subtotal (all lines)”, “Invoice discount”,
  “Total payable” on the summary line. The Walk-in invoice line additionally carries the
  **Line discount (৳)** it already supported, and its summary adds
  “Still due after the amount received”. **No calculation changed** — see §5.
* Remaining placeholder-only controls that were deliberately *not* converted are listed in
  `docs/KNOWN_LIMITATIONS.md` rather than being claimed as fixed.

## 2. One medicine-row editor for both prescription workflows

Main Prescription (`Patients → Prescription`) and Walk-in Prescription now share
`src/renderer/components/medicine-entry.tsx`, so the two screens cannot drift apart again:

* visible labels and hints on every field, including the previously unnamed ones;
* a responsive grid (the medicine name and the instruction column are wider, nothing is clipped);
* one clear action to add a row and a **confirmation before removing a row that contains data**, so a
  typo cannot silently discard a medicine;
* the same 60-medicine limit, the same dosage-form list and the same frequency hints on both screens;
* an empty list and a full list are both explained instead of silently doing nothing.

## 3. Walk-in Prescription now matches Main Prescription

* **C/C (chief complaint)** and **O/E (on examination)** are dropdowns of the clinic's usual wording
  with short explanations, plus an **“Other — type it myself”** option that reveals a free-text field.
  Manual entry is preserved exactly as before — nothing is forced into a fixed list.
* **R/E, Diagnosis, Treatment, Advice and Follow-up** are labelled with hints, and advice/follow-up
  say what they do (follow-up prints on the prescription; it does not create an appointment).
* Prescription-text and instruction templates can be applied to a walk-in draft in **read-only** mode:
  an existing template can be used, but creating or deleting templates stays in the screens that
  legitimately own them, and using one here still writes nothing but an audit entry.
* Applying a saved **medicine template** fills the rows and asks first when rows are already typed.
* The walk-in contract is unchanged: no patient record, no invoice number, no WhatsApp surface.

## 4. Optional single-line medicine instruction (both modules + print)

A doctor who prefers one line can now write the whole instruction as free text beneath the structured
rows:

> `Tab.Napa - 100MG - 1+0+1/ or 2 Times -1 Tab - 7 Days - After Meals`

* **Optional and never auto-inserted.** The example is helper text only; nothing is parsed into the
  structured fields and nothing is generated on your behalf.
* **Stored safely.** Stored prescriptions keep it in a new nullable `prescriptions.medicine_instruction`
  column (schema 7, additive); walk-in prescriptions carry it in the validated quick-document payload.
  Both are capped at 500 characters, trimmed, and rejected — never silently truncated — when longer.
* **Printed once, deterministically.** Structured rows print exactly as before; the single-line
  instruction prints as its own labelled block underneath them. Nothing is merged, reordered,
  deduplicated or repeated. When both are filled the form says so before saving, so the doctor
  decides what appears on the paper.
* **Backward compatible by construction.** Every prescription saved before 4.1.3 has `NULL` there and
  prints byte-identically; the printed document simply omits the block.
* The label (`Medicine Instruction`) is one of the clinic-renamable prescription labels in
  Settings → Prescription, and every label is validated on save and completed with its default on
  read, so a settings row written by 4.1.2 upgrades without a blank heading.

## 5. Invoice field meanings (documentation, not arithmetic)

The line model always was `qty` = number of units, `unit_price_paisa` = price of one unit,
line total = qty × unit price − line discount, then invoice discount → amount received → due. 4.1.3
only *labels* those meanings in the form (and in the printed invoice header, “Unit” still means unit
price). `src/shared/billing-math.ts` is untouched, and the existing billing tests pass unchanged.

## 6. Configurable clinic-logo watermark

Settings → Customize Documents gains a **Clinic logo watermark** panel:

* enable/disable, **size** (10–100 % of the page) and **transparency** (0.02–0.5) sliders with live
  numbers, a live preview using the real document renderer, and a **reset to defaults** button;
* **exactly page-centred**, sized from the real page geometry in millimetres, so it is centred on A4,
  A5 and custom paper, portrait or landscape, at any window size and preview zoom;
* the logo keeps its aspect ratio (`object-fit: contain`) — scaled to fit, never stretched, never
  clipped;
* **behind the document content** and repeated on each printed page, so patient details, tables,
  totals and signatures stay legible; only the logo is transparent;
* **disabled by default**, and an installation that never enables it renders no watermark element at
  all; a missing logo degrades to “no watermark” instead of a broken image or a failed document;
* applies to prescriptions (including duplicates), invoices, receipts, visit summaries, appointment
  cards and reports in both workflows; the compact stock & expiry label sheet is deliberately excluded
  because its labels are small;
* validated and clamped on save **and** on read, so a hand-edited or corrupt settings row can never
  put an out-of-range or oversized mark on a document.

## 7. Audit, hardening and tests

* Whole-application review during this release (data loss, security, calculation order first) with the
  fixes that were safe to make without changing stored semantics; the review notes and the remaining
  items live in `docs/AGENT_PROGRESS.md` and `docs/KNOWN_LIMITATIONS.md`.
* New automated coverage: the shared clinical option registry, the medicine-instruction model and its
  print path, the watermark model/geometry/rendering, the walk-in payload bound, the settings
  round-trip (labels + watermark, including legacy upgrade and corrupt-row degradation) and the
  prescription `medicine_instruction` round-trip.
* `npm run typecheck`, `npm run lint`, the unit/integration suite (**48 files / 521 tests**) and
  `npm run build` all pass on this commit; the Windows E2E and NSIS installer checks run in CI for this tag (see the release page for
  their status).
* Not verified here: physical printer output, PDF byte comparison, on-paper watermark centring and
  multi-page repetition, and the printed medicine instruction on real paper. See
  `docs/PRINTING.md` → “Verification still required”.

## 8. Compatibility and data safety

* **Database:** one forward-only migration (007) adds the nullable `prescriptions.medicine_instruction`
  column. Existing rows keep `NULL` and read exactly as before. No column is dropped, no value is
  rewritten, no table is rebuilt.
* **Settings:** new key `watermark` (absent means disabled) and one new prescription label key that is
  filled from its default on read. A settings row written by 4.1.2 keeps working and keeps printing
  its stored labels.
* **Documents:** with no customization and no watermark, output is unchanged — this is enforced by
  `tests/unit/document-layout.test.ts`, which renders every document through a frozen pre-4.1.2
  implementation and requires the markup to match.
* **Offline:** unchanged. No cloud service, no telemetry, no paid API, no new runtime dependency.
