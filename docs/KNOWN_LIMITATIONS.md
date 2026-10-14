# Dentiva Pro — known limitations

This file records what the application deliberately does **not** do, and what the v4.2.x clinical-entry,
label and watermark work deliberately did **not** change. It exists so that a partial fix is never
described as a complete sweep. Each entry states the limitation, why it was not changed, and what a
clinic should expect in the meantime.

Last reviewed: **v4.2.1** (2026-10-14).

---

## 1. Field labels — what is labelled and what is not (Mandatory 1)

### 1.1 Converted

Every data-entry field that a clinician or counter operator fills in carries a **visible, persistent
label**, and every shared `Input`/`Select`/`Textarea` in the renderer carries either a visible label or
an explicit accessible name. `tests/unit/form-label-policy.test.ts` enforces this from the source and
fails on a new unlabelled control; `tests/unit/document-forms-a11y.test.ts` additionally renders the
walk-in form and the customize-documents panel and requires every `for=`/`id=` pair in the markup to
resolve.

Specifically converted: the Main and Walk-in prescription medicine rows (previously placeholder-only),
the C/C and O/E pickers in both prescription forms, the Walk-in R/E, diagnosis, treatment, advice and
follow-up fields, the Walk-in procedure and invoice line rows, the Main invoice line fields, the patient
picker on all three patient dialogs, the per-treatment quantity in the visit form, the lock-screen
password field, the watermark sliders and prescription-label editor in Settings, the clinical-template
name field, and the clinical document “Add from treatments” pickers.

### 1.2 Deliberately left as accessible-name-only (no visible label)

These controls keep their placeholder as the **visible** affordance and are named for assistive
technology only. A visible label above a toolbar filter adds a second line of chrome to every list screen
and pushes the table down; the placeholder stays visible at rest because these controls are reset, not
typed into, and each one sits next to a visible group heading or in a labelled toolbar position.

| Screen | Control | How it is named |
| --- | --- | --- |
| Patients list | search box, date-range filter, status filter | `aria-label` “Search patients”, “Filter by date range”, “Filter by patient status” |
| Prescriptions list | search box | `aria-label` “Search prescriptions” |
| Invoices / Payments | search box, date-range filter, status filter, method filter | `aria-label` on each |
| Audit log | search box, action filter | `aria-label` on each |
| Inventory | search box | `aria-label` “Search inventory items” |
| Staff, Treatments, Users | search boxes | `aria-label` on each |
| Appointments | patient search, dentist/reason/status filters | `aria-label` on each |
| Patient chart / dental chart | tooth condition and severity selects | `aria-label` “Condition”, “Severity” |
| Customize Documents | document-to-customize picker | `aria-label` “Document to customize” |
| Walk-in invoice | “Add from treatments” picker | `aria-label` “Add an invoice line from saved treatments” |

**Limitation:** for these controls the visible text disappears once a value is chosen or typed, and a
sighted operator who has never used the screen has only the neighbouring heading and the cleared filter
to go by. This is a presentation choice, not a data-entry risk: none of them stores a clinical value, and
each one can be cleared back to its placeholder. Turning every toolbar placeholder into a permanent
label is a follow-up UI change, not a correctness fix.

### 1.3 Not addressed

* **Bengali label coverage.** Labels, hints and placeholders are English; Bengali is used for the printed
  clinic name and the bilingual prescription fields that already existed. Adding a full bilingual UI is a
  translation project, not a labelling fix, and inventing Bengali strings without a review would be worse
  than leaving the English ones.
* **Raw `<input>`/`<select>` elements outside the shared primitives.** A few controls use raw HTML (for
  example the audit date filters and the two watermark range sliders) and are labelled directly with
  `htmlFor`/`id` or `aria-label`. They are covered by the label-policy and a11y tests, but they do not get
  the shared hint/error styling.
* **Autocomplete on clinical fields.** The brief marked autocomplete as optional. The C/C and O/E fields
  offer dropdowns plus an “Other” free-text path; frequency/duration offer static suggestions. There is
  no type-ahead that learns from previous entries, and no `combobox` primitive exists in the codebase, so
  no new control contract was invented for it.
* **A fixed-width column can still truncate a *hint*** (never a stored value). The narrow-column grids
  that clipped placeholder fragments inside the walk-in medicine rows are gone — both prescription
  modules use the shared labelled row editor (`src/renderer/components/medicine-entry-editor.tsx`).

## 2. Medicine instruction (Mandatory 4)

* It is an **optional single free-text line per medicine**, not a structured dosage engine. It is never
  parsed into morning/afternoon/night fields, never auto-filled, and the example line quoted in the
  requirement (`Tab.Napa - 100MG - 1+0+1/ or 2 Times -1 Tab - 7 Days - After Meals`) is illustrative
  only — it is **not** inserted by the application.
* The stored value is capped at 500 characters; a longer value is rejected with a validation message and
  nothing is written. Stored text is kept **verbatim** (leading/trailing spaces and internal spacing are
  preserved) so a line copied from another system still prints exactly as typed. Blank, whitespace-only
  or missing input stores `NULL` and prints nothing.
* **When both the structured fields and the one-line instruction are filled, the one-line instruction
  replaces the structured dosage, frequency, duration, quantity and administration note on the printed
  prescription** — it is not merged with them. The structured values stay saved in their own columns and
  return as soon as the line is cleared. The form shows a warning callout
  (`role="note"`, “The one-line instruction replaces the structured dosing details in print”) as soon as
  both are populated, so the choice is never silent. This is the deterministic behaviour of the print
  path; the alternative (printing both) was rejected because it produced duplicate, conflicting dosing
  text on the same prescription.
* Stored prescriptions and their saved medicine templates carry the line through (`prescription_items.
  medicine_instruction`, schema 7, added by migration 007 on both upgrade and fresh install). Walk-in
  prescriptions remain transient: the line is printed and audited with the rest of the walk-in payload,
  but no clinical row is created.
* The line prints on the prescription only. It does not appear on invoices, receipts, visit summaries or
  the appointment card.

## 3. Clinic-logo watermark (Mandatory 6)

* Disabled by default; enabling it changes printed output for the documents listed in
  `docs/PRINTING.md`. Receipts and stock/expiry labels are excluded by design.
* One logo, clinic-wide: there is no per-document-type logo, no rotation, no tiling and no “first page
  only” option. Size (15–70 % of the page's shorter edge) and opacity (0.04–0.3) are the only controls,
  because those are the two values that change legibility. Values outside those windows are clamped on
  save and again on read; a missing, blank or non-numeric stored value falls back to the default instead
  of being read as zero.
* A missing or unreadable logo means **no watermark**, not an error; the panel says so and the preview
  simply shows the document.
* On-paper centring, multi-page repetition and printer colour handling have not been verified on a
  physical printer in this development environment (no display and no printer here). The geometry is
  computed from the real page size in millimetres and the CSS is page-relative, but print it on your own
  printer once before relying on it for a batch of documents.

## 4. Areas not covered by the audit in this environment

* **Electron GUI / Playwright E2E and the NSIS installer** cannot be exercised in the Linux sandbox used
  for this release; they run on Windows CI (`windows-latest`). Claims about them come from the CI run for
  the exact commit, not from this environment.
* **Physical printing, PDF page content, on-paper watermark behaviour and Bengali glyph shaping** remain
  unverified locally (see `docs/PRINTING.md` → “Verification still required”).
* **The walk-in prescription still creates no patient record.** That is the documented contract of the
  workflow, not a defect: registering the customer is a separate, deliberate action.
* **Reports and exports** were reviewed for calculation correctness but were not restructured; no report
  formula changed in this release.
