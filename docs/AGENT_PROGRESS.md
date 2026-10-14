# Dentiva Pro — comprehensive product-quality upgrade (v4.1.3) — durable progress log

This file is the interruption-recovery record for the **v4.1.3** effort (comprehensive audit,
mandatory UI/workflow changes, watermark feature, testing, Windows build, release). It is updated
after every meaningful milestone. A task is only marked **done** when its result was *observed*,
never when it was started.

## 0. Branch / commit policy for this release

- Development branch: `arena/892cf688-dentiva-windows-application` (this Arena session's branch —
  the name is session-fixed and cannot be renamed). Branched from `main` at
  `1c901a34f2d0160b614a751684cacee80fff544b`.
- All v4.1.3 work happens on this branch; the release is published from a commit that is on `main`
  (CI enforces `git merge-base --is-ancestor` against `main` before publishing).

## 1. Baseline (recorded before any source change)

| Item | Value |
| --- | --- |
| Starting commit | `1c901a34f2d0160b614a751684cacee80fff544b` (merge of PR #29 on `main`) |
| Working tree | clean |
| `package.json` version | `4.1.2` |
| Latest published release | [Dentiva Pro 4.1.2](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v4.1.2) (*Latest*, tag `v4.1.2` → `b86a1a3…`) |
| Existing tags | `v2.0.x`, `v3.0.0`–`v3.0.3`, `v3.1.0`, `v4.0.0`, `v4.1.0`, `v4.1.1`, `v4.1.2` (no `v4.1.3`) |
| Schema version | 6 (migrations `001_init` … `006_whatsapp`) |
| Test suite | Vitest **43 files / 472 tests — all passing** (`npm test`, 18.11 s) |
| Typecheck | `tsc -p tsconfig.renderer.json --noEmit` → 0; `tsc -p tsconfig.node.json --noEmit` → 0 |
| Lint | `npx eslint .` → 0 |
| Production build | `npm run build` → clean |
| Electron E2E / NSIS installer | **not runnable in this sandbox** (Linux container, no display, Electron binary intentionally not downloaded). Windows CI (`windows-latest`) is the E2E + installer + installed-smoke-test gate. |

Install command that works in this sandbox (the repo pins a Windows-only optional dependency and
`node-gyp` cannot fetch headers here):

```
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --force --ignore-scripts
```

`better-sqlite3` 13.x ships its own `prebuilds/` inside the npm tarball, so the SQLite-backed
integration tests run here without compilation.

## 2. Architecture findings relevant to this release

| Area | Finding |
| --- | --- |
| Prescription form (Main) | `RxFormModal` in `src/renderer/pages/Patients.tsx`. C/C and O/E are **hard-coded option arrays inside the component**; "Other" reveals a free-text field. Medicine rows are `.rx-item` cards with 8 labelled fields (name, generic, strength, dosage, frequency, duration, quantity, instruction). Layout: `.rx-grid`. |
| Prescription form (Walk-in) | `QuickDocuments.tsx` → `PrescriptionFields`. C/C, O/E and R/E are **plain unlabelled free-text inputs**, medicine rows are a `.line-editor` grid of nine inputs that carry **only placeholders** (no labels at all) — this is the "field showing F / 3" class of defect: the clipped placeholder of a 116 px column is the only affordance. |
| Medicine persistence | `prescription_items` (structured: name/generic/form/strength/dosage/frequency/morning/afternoon/night/timing/duration/qty/instruction/instruction_bn/note). Walk-in prescriptions are transient and never stored (documented contract). |
| Templates | `medicine_templates` (medicine sets, applied by the Main form) and `clinical_templates` (kinds `visit`,`plan`,`notes`,`prescription`,`instructions`,`invoice_items`). `ClinicalTemplatePicker` is already shared. |
| Print pipeline | Every printable document is produced by `src/renderer/documents/print-documents.tsx` in the print window (`PrintPage.tsx`). `tests/unit/document-layout.test.ts` pins the *default* markup against a frozen pre-4.1.2 copy — proof that the original design is the source of truth. |
| Existing watermark | Only `prescription-duplicate` renders `.print-watermark` with the diagonal word "Specimen" (`position: fixed`). There is no configurable logo watermark. |
| Invoice model | `invoice_items(description, treatment_id, qty, unit_price_paisa, discount_paisa, total_paisa)`; `qty` = integer count, `unit_price_paisa` = price of one unit, `discount_paisa` = optional line discount. Invoice totals come from `src/shared/billing-math.ts` (shared with the walk-in path). The printed invoice table labels its price column "Unit", which is the reported confusion. |
| Settings | One JSON row per key in `settings`; `getSettings`/`saveSettings` validate and normalize. `documentStyles` is the existing customization map; `Settings.tsx` saves the whole form object, so a new key needs only DTO + service validation. |

## 3. Task board

| Task | Status |
| --- | --- |
| Repository inspection + baseline capture | done — §1 |
| Durable progress log | done — this file |
| Mandatory 1 — clear labels for every unclear input (app-wide) | implemented — label policy enforced by `tests/unit/form-label-policy.test.ts`; remaining accessible-name-only controls listed in `docs/KNOWN_LIMITATIONS.md` §1.2 |
| Mandatory 2 — consistent medicine-entry layout in both prescription modules | implemented — both modules render the shared `MedicineRowsEditor` |
| Mandatory 3 — Walk-in C/C + O/E sub-options and templates | implemented — shared option lists + “Other” free text; read-only clinical templates + medicine templates |
| Mandatory 4 — optional single-line medicine instruction (both modules + print) | implemented — migration 007, both forms, both print paths, single-output rule |
| Mandatory 5 — clarify Main + Walk-in invoice fields | implemented — labels/hints only, no arithmetic change |
| Mandatory 6 — configurable, centered clinic-logo watermark | implemented — Settings panel + preview + print layer; disabled by default |
| Mandatory 7 — autonomous whole-application audit and fixes | in progress — see §4.5, findings recorded in `docs/KNOWN_LIMITATIONS.md` |
| Tests (unit / integration / layout / E2E) | unit + integration done locally; E2E runs on Windows CI |
| Build + Windows packaging | `npm run build` local; NSIS + installed smoke test on Windows CI |
| Version + tag + GitHub release | bumped to 4.1.3; tag/release pending CI packaging |

## 4. Mandatory work — implementation notes

### 4.1 Shared clinical option registry (Mandatory 1 + 3)

`src/shared/clinical.ts` gains `CHIEF_COMPLAINT_OPTIONS` and `EXAMINATION_OPTIONS` — the exact
option **values** already stored by Main Prescription (`Pain On`, `G. Carries`, `BDR/BDC`, …) with
clear, correctly-spelled dropdown **labels** and short explanations. Values are preserved verbatim
on purpose: they are what existing rows contain and what the printed document shows, so old
prescriptions print byte-identically (`docs/` records this decision).

### 4.2 Shared medicine-row editor (Mandatory 1 + 2 + 4)

New `src/renderer/components/medicine-entry.tsx` — one labelled, responsive row editor used by
*Main Prescription and Walk-in Prescription*, so the two screens cannot drift apart again.

### 4.3 Optional single-line medicine instruction (Mandatory 4)

- Schema: migration **007** adds the nullable `prescriptions.medicine_instruction` column
  (additive; existing rows keep `NULL` and open exactly as before).
- Both forms expose `Medicine instruction (optional)` beneath the structured rows.
- Output rule (deterministic, documented in `docs/PRESCRIPTIONS.md`): structured rows keep their
  existing output; the free-text line renders as its own labelled block and is **never** merged
  into or repeated alongside a structured row. When both are present the form shows a warning
  telling the operator that both will print — nothing is silently dropped or duplicated.

### 4.4 Clinic-logo watermark (Mandatory 6) — implemented

`src/shared/watermark.ts` (model, bounds, normalization, geometry) + `WatermarkLayer`
(`src/renderer/documents/watermark-layer.tsx`) rendered by the print window (`PrintPage.tsx`) and by
`DocumentPreview` (Settings preview and the walk-in preview), so preview and print cannot disagree.
Disabled by default; page-centered from the real page geometry in millimetres; aspect ratio preserved
(`object-fit: contain`); behind document content; applied to every printable document except the
compact stock/expiry label sheet (deliberate exception, `WATERMARK_EXCLUDED_KINDS`). The panel lives
in Settings → Customize Documents (`WatermarkPanel`) with enable, size, transparency, live preview,
reset and a missing-logo warning.

### 4.5 Labelling policy (Mandatory 1) — implemented

`Field` supplies visible labels and ids; a new `ariaLabel` prop on `Input`/`Select`/`Textarea`
supplies an accessible name for toolbar filters and search boxes, which keeps the policy honest:
`tests/unit/form-label-policy.test.ts` fails on any renderer control that has neither. What remains
accessible-name-only is listed, with the reason, in `docs/KNOWN_LIMITATIONS.md` §1.2 — the sweep is
reported as a policy plus a documented exception list, not as an unverifiable "everything is fixed".

## 5. Milestone log

| # | Milestone | Evidence |
| --- | --- | --- |
| 1 | Baseline captured on `1c901a3` | §1 — 43 files / 472 tests, typecheck + lint + build clean |
| 2 | Shared clinical registry + shared medicine-row editor + Walk-in rewrite | `src/shared/clinical.ts`, `src/renderer/components/medicine-entry.tsx`, `QuickDocuments.tsx` |
| 3 | Optional single-line medicine instruction end to end | migration `007`, both forms, `print-documents.tsx`, quick payload |
| 4 | Clinic-logo watermark end to end | `src/shared/watermark.ts`, `watermark-layer.tsx`, Settings → Customize Documents, print window |
| 5 | Label/hint sweep + label-policy regression test | `tests/unit/form-label-policy.test.ts` (3 tests), every renderer control labelled or named; exceptions documented |
| 6 | New automated coverage | `clinical-options`, `watermark`, `prescription-instruction-print`, `medicine-instruction-settings`, extended `quick-documents` |
| 7 | Full local gate green | typecheck + lint clean; **48 files / 521 tests passing** (`npm test`); `npm run build` clean |
| 8 | Version + docs | `package.json`/`package-lock.json` → 4.1.3; `docs/RELEASE_NOTES_4.1.3.md`; `docs/KNOWN_LIMITATIONS.md` |

## 6. Audit notes (Mandatory 7) — what was checked and what was found

| Area | Check | Outcome |
| --- | --- | --- |
| Stored records | `prescriptions` read/write path, DTO, print mapping | Passed — the new column is nullable and additive; legacy rows read `NULL` |
| Calculation order | `shared/billing-math.ts`, invoice line maths, walk-in invoice maths | Passed — untouched; only labels/hints changed |
| Settings | read/write validation for `documentStyles`, `watermark`, prescription labels | Hardened — labels are now validated on write **and** completed with defaults on read; watermark is clamped on both paths |
| Input sanitising | every new value entering the DB or a document | Passed — `optString(..., max)` / `str(..., max)` / `reqString(..., max)` on every new field |
| Accessibility | every renderer control | Fixed — the three unassociated `<label>`s on the patient picker, plus accessible names for toolbar filters; policy test added |
| Data loss | template application over a half-typed prescription | Fixed — applying a saved medicine template now asks before replacing typed rows (both modules) |
| Removal safety | deleting a medicine row that contains data | Fixed — confirmation before discarding a non-empty row |
| Watermark safety | disabled default, corrupt settings, missing logo, excluded documents | Passed — unit tests cover each case |
| Remaining items | documented, not silently dropped | `docs/KNOWN_LIMITATIONS.md` |

## 7. Next action

Commit the verified tree, open the PR, merge to `main`, then tag `v4.1.3` on the merge commit so the
Windows CI job produces `DentivaPro-Setup-4.1.3.exe`, its SHA-256 file and the GitHub release.
