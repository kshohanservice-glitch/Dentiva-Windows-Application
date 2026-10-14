# Dentiva Pro — known limitations

This file records what the application deliberately does **not** do, and what the v4.1.3
label/UX work deliberately did **not** change. It exists so that a partial fix is never described as a
complete sweep. Each entry states the limitation, why it was not changed, and what a clinic should
expect in the meantime.

Last reviewed: **v4.1.3** (2026-10-14).

---

## 1. Field labels — what is labelled and what is not (v4.1.3, Mandatory 1)

### 1.1 Converted in v4.1.3

Every data-entry field that a clinician or counter operator fills in now carries a **visible,
persistent label**, and every `Input`/`Select`/`Textarea` in the renderer carries either a visible
label or an explicit accessible name. This is enforced by
`tests/unit/form-label-policy.test.ts`, which fails on a new unlabelled control, and by the fact that
the policy test and the layout tests run in CI.

Specifically converted: the Main and Walk-in prescription medicine rows (previously placeholder-only),
the C/C and O/E pickers in both prescription forms, the Walk-in R/E, diagnosis, treatment, advice and
follow-up fields, the Walk-in procedure and invoice line rows, the Main invoice line fields, the
patient picker on all three patient dialogs, the lock screen password field, the prescription label
editor and watermark sliders in Settings, the clinical-template name field, and the clinical
document “Add from treatments” pickers.

### 1.2 Deliberately left as accessible-name-only (no visible label)

These controls keep their placeholder as the **visible** affordance and are named for assistive
technology only. A visible label above a toolbar filter adds a second line of chrome to every list
screen and pushes the table down; the placeholder is always visible at rest because these controls are
reset, not typed into, and each one sits next to a visible group heading (“Lines”, “Procedures”) or in
a labelled toolbar position.

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
| Visit form — procedures this visit | per-row quantity | `aria-label` “Quantity of <treatment>” |

**Limitation:** for these controls the visible text disappears once a value is chosen or typed, and a
sighted operator who has never used the screen has only the neighbouring heading and the cleared
filter to go by. This is a presentation choice, not a data-entry risk: none of them stores a clinical
value, and each one can be cleared back to its placeholder. Turning the placeholder into a permanent
label is a follow-up UI change, not a correctness fix.

### 1.3 Not addressed in v4.1.3

* **Bengali label coverage.** Labels, hints and placeholders are English; Bengali is used for the
  printed clinic name and the bilingual prescription fields that already existed. Adding a full
  bilingual UI is a translation project, not a labelling fix, and inventing Bengali strings without a
  review would be worse than leaving the English ones.
* **Plain `<input>`/`<select>` elements outside the shared primitives.** A small number of controls
  use raw HTML (for example the date inputs in the audit filter and the range sliders in the watermark
  panel) and carry `aria-label` directly. They are covered by the policy test, but they do not get the
  shared hint/error styling.
* **Autocomplete on clinical fields.** The brief marked autocomplete as optional. The C/C, O/E and
  frequency fields offer dropdowns and static suggestions instead; there is no type-ahead that learns
  from previous entries. No `combobox` primitive exists in the codebase and v4.1.3 deliberately did
  not add a new control contract for it.
* **“F” / “3”-style clipped columns.** The walk-in medicine grid that produced clipped placeholder
  fragments is gone (both modules now use the shared labelled row editor). Controls elsewhere can
  still wrap rather than clip; a fixed-width column that is too narrow will truncate a *hint*, never a
  stored value.

## 2. Medicine instruction (v4.1.3, Mandatory 4)

* It is a **single free-text line**, not a structured dosage engine. It is never parsed into
  morning/afternoon/night fields, never auto-filled and never generated from the structured rows.
* If a doctor fills **both** the structured rows and the single line, **both print**, in a fixed order
  (structured list first, then the labelled instruction block). The form warns before saving; the
  application does not guess which one was meant and does not delete either.
* The stored value is capped at 500 characters and the form rejects a longer value. It is trimmed and
  inner whitespace is collapsed for display, so an instruction copied from another system may look
  re-spaced. Nothing else is altered — `+`, `/`, `.`, `-` and Bengali text are preserved.
* Walk-in prescriptions are transient: their instruction is printed and audited but not stored as a
  record, exactly like the rest of the walk-in payload.
* The line prints on the prescription only. It does not appear on invoices, receipts, visit summaries
  or the appointment card.

## 3. Clinic-logo watermark (v4.1.3, Mandatory 6)

* Disabled by default; enabling it changes printed output for the documents listed in
  `docs/PRINTING.md`. Stock & expiry labels are excluded by design.
* One logo, clinic-wide: there is no per-document-type logo, no rotation, no tiling and no
  “first page only” option. Size (10–100 % of the page) and transparency (0.02–0.5) are the only
  controls, because those are the two values that change legibility.
* A missing or unreadable logo means **no watermark**, not an error; the panel warns when the feature
  is enabled without a logo.
* On-paper centring and multi-page repetition have not been verified on a physical printer in this
  development environment (no display and no printer here). The geometry is computed from the real
  page size in millimetres and the CSS is page-relative, but print it on your own printer once before
  relying on it for a batch of documents.

## 4. Areas not covered by the v4.1.3 audit

* **Electron GUI / Playwright E2E and the NSIS installer** cannot be exercised in the Linux sandbox
  used for this release; they run on Windows CI (`windows-latest`). Claims in the release notes about
  them come from the CI result for the tagged commit, not from this environment.
* **Physical printing, PDF page content and Bengali glyph shaping** remain unverified locally (see
  `docs/PRINTING.md` → “Verification still required”).
* **The walk-in prescription still creates no patient record.** That is the documented contract of the
  workflow, not a defect: registering the customer is a separate, deliberate action.
* **Reports and exports** were reviewed for calculation correctness but were not restructured; no
  report formula changed in this release.
