# Dentiva Pro — release-hardening progress log (v4.2.1) — durable recovery record

This file is the interruption-recovery record for the **v4.2.1** effort: merging the parallel v4.2.0
release back into this session's branch, auditing and repairing the merged implementation, keeping the
branch's unique labelling policy, and publishing a verified release. It is updated after every
meaningful milestone. A task is only marked **done** when its result was *observed*, never when it was
started.

## 0. Branch / commit policy

- Development branch: `arena/892cf688-dentiva-windows-application` (this Arena session's branch — the
  name is session-fixed and cannot be renamed). Branched from `main` at
  `1c901a34f2d0160b614a751684cacee80fff544b`.
- `main` has since advanced to `06831e3` (merge of PR #31, release **v4.2.0**, tag on `f5d6874`). That
  release independently implemented the same mandatory items under different module names, so this
  branch was **merged with `origin/main`** instead of publishing a competing 4.1.3.
- The release is published from a commit that is on `main` (CI enforces `git merge-base --is-ancestor`
  before publishing) and only for a tag whose version matches `package.json`.

## 1. Baseline and current state

| Item | Value |
| --- | --- |
| Branch tip before the merge | `0161f72` (feat 4.1.3 + docs 4.1.3), PR **#32** open with all three CI checks green |
| `origin/main` at merge time | `06831e3` — `package.json` = `4.2.0`, release v4.2.0 published 2026-10-14T15:40:58Z |
| Merge strategy | `git merge origin/main`; every content conflict resolved to **main's** implementation (it is the released, Windows-CI-verified behaviour), then this branch's genuinely unique files kept and the audit fixes below added on top |
| Unique files kept from this branch | `tests/unit/form-label-policy.test.ts`, `docs/KNOWN_LIMITATIONS.md`, this log |
| Modules dropped in favour of main's equivalents | `src/shared/{clinical,watermark}.ts` → `clinical-options.ts` / `document-watermark.ts`; `medicine-entry.tsx` → `medicine-entry-editor.tsx`; migration `007_medicine_instruction` → `007_prescription_medicine_instruction` |
| Schema version | 7 (both migrations 007 variants add the same nullable instruction column; exactly one survives the merge) |
| Install command for this sandbox | `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --force --ignore-scripts` |
| Electron E2E / NSIS installer | **not runnable in this sandbox** (Linux container, no display, Electron binary intentionally not downloaded). Windows CI (`windows-latest`) is the E2E + installer + installed-smoke-test gate. |

## 2. Task board

| Task | Status |
| --- | --- |
| Merge `origin/main` (v4.2.0) into this branch, one behaviour per module | done — conflicts resolved to main's released implementation, unique files preserved |
| Mandatory 1 — clear labels for every unclear input (app-wide) | done — label policy enforced by `tests/unit/form-label-policy.test.ts`; the one remaining unlabelled control found by the gate fixed; accessible-name-only controls documented in `docs/KNOWN_LIMITATIONS.md` §1.2 |
| Mandatory 2 — consistent medicine-entry layout in both prescription modules | done (main's `MedicineEntryEditor`; verified in the merged tree) |
| Mandatory 3 — Walk-in C/C + O/E options with manual entry | done (main's `CHIEF_COMPLAINT_OPTIONS` / `EXAMINATION_OPTIONS` + “Other” free text in both modules) |
| Mandatory 4 — optional single-line medicine instruction | done; documented that the line **replaces** structured dosing in print, with an in-form warning |
| Mandatory 5 — clarify Main + Walk-in invoice fields | done (labels/hints only, no arithmetic change) |
| Mandatory 6 — configurable, centered clinic-logo watermark | done — plus two audit fixes: invisible-layering bug, corrupt-settings normalization; reset control added |
| Mandatory 7 — autonomous whole-application audit | done for this pass — four real defects found and fixed (§4) |
| Tests | unit + integration green locally (47 files / 514 tests, main's suite plus the restored coverage); E2E on Windows CI |
| Build + Windows packaging | `npm run build` clean locally; NSIS + installed smoke test on Windows CI |
| Version + tag + GitHub release | `package.json` → 4.2.1, `docs/RELEASE_NOTES_4.2.1.md`; tag/release after CI packaging |

## 3. What this branch adds on top of main's v4.2.0

1. **Label policy as an executable gate** — `tests/unit/form-label-policy.test.ts` reads the renderer
   source and fails on any `Input`/`Select`/`Textarea` without a visible label or an explicit
   accessible name, and on any CSS that hides a field label.
2. **`docs/KNOWN_LIMITATIONS.md`** — what is labelled, what is named for assistive technology only, and
   what was deliberately not changed (Bengali labels, raw HTML controls, autocomplete, instruction
   semantics, unverified on-paper behaviour).
3. **Audit fixes** — see §4; three of them are defects in the shipped v4.2.0 code.
4. **Restored test depth** — the branch-specific assertions that the merge would otherwise have dropped
   (500-character bound, omitted/blank → `NULL`, verbatim spacing, option-list integrity, watermark
   normalization edges, CSS layering, settings persistence) now live inside main's own test files, so
   there is one suite per subject rather than two competing ones.

## 4. Audit findings fixed in this pass (Mandatory 7)

| # | Finding | Evidence | Fix |
| --- | --- | --- | --- |
| 1 | **Clinic-logo watermark was invisible on screen and on paper.** `.print-logo-watermark` used `z-index: -1`, so the mark painted *below* the white page backgrounds of `.print-stage` / `.print-doc` (and of the print root). The markup tests could not see this because they render the mark in isolation. | CSS painting order; `print.css` backgrounds at `html, body, #root, .print-root`, `.print-stage`, `.print-doc` | Watermark paints at `z-index: 0`; document body wrapped in `.print-doc-content` (`position: relative; z-index: 1`), `.print-doc` made the positioning context; `tests/unit/document-watermark.test.ts` asserts the layering rules from the stylesheet |
| 2 | **Corrupt watermark settings silently became the smallest mark.** `normalizeDocumentWatermark` used `Number(value)`, and `Number(null) === 0` / `Number('') === 0`, so a hand-edited `opacity: null` clamped *up* to the 0.04 minimum instead of falling back to the 0.12 default (same for `sizePercent`, and numeric strings were accepted). | Repairing the branch's own ported integration expectation exposed it: expected default `0.12`, got `0.04` | New `numericSetting()` accepts only a real finite `number`; everything else falls back to `DEFAULT_DOCUMENT_WATERMARK`. Asserted in unit and integration tests |
| 3 | **Unlabelled control in the visit form.** The per-treatment quantity `Input` in `Patients.tsx` had no label and no accessible name (the label-policy gate flagged `Patients.tsx:1264`). | `npx vitest run tests/unit/form-label-policy.test.ts` → 1 failed control | Added `ariaLabel={\`Quantity of ${treatment name}\`}` |
| 4 | **Dead CSS.** `.line-editor` was still defined in `documents.css` although no markup renders it after the shared editor replacement. | `grep -rn "line-editor" src/` → only the stylesheet | Rule removed |

Also checked and found **correct** (no change): the watermark allow-list (receipts and stock labels
excluded), the aspect-ratio contract (no `width`/`height` attributes, `object-fit: contain`),
`@media print` repetition via `position: fixed`, the label/id wiring of the watermark sliders and the
walk-in fields (`tests/unit/document-forms-a11y.test.ts` asserts every `for=`/`id=` resolves), the
“no patient row is written” walk-in contract, the invoice arithmetic (`shared/billing-math.ts`
untouched), and instruction storage/validation (500-character bound, verbatim text, `NULL` for blank).

## 5. Milestone log

| # | Milestone | Evidence |
| --- | --- | --- |
| 1 | Pre-merge gate on `0161f72` | 48 files / 521 tests, typecheck + lint + build clean; PR #32 CI fully green (verify, Windows E2E, NSIS + installed smoke test) |
| 2 | Merge of `origin/main` resolved deliberately | tree = `origin/main` + 3 unique files; no `Broken Tooth` re-add (verified it never existed: `git grep` on `1c901a3` and the raw option list) |
| 3 | Audit fixes applied | §4 — watermark layering, settings normalization, unlabelled control, dead CSS |
| 4 | Test depth restored inside main's files | `document-watermark` 4 → 17 tests, `clinical-options` 2 → 5, `quick-documents` +4, `prescription-medicine-instruction` 2 → 11 |
| 5 | Local gate re-run on the merged tree | typecheck 0 errors; lint clean; `npm test` **47 files / 514 tests** (main's 47-file suite plus the restored coverage); `npm run build` clean |
| 6 | Docs for the merged release | `docs/KNOWN_LIMITATIONS.md`, `docs/PRINTING.md` (watermark section), `docs/RELEASE_NOTES_4.2.1.md`, this log |
| 7 | Version bump | `package.json` + `package-lock.json` → `4.2.1` |
| 8 | CI + release | done — branch pushed (`84009c2`), PR #32 re-verified on CI run 38595558756 (verify, Windows E2E, NSIS + installed smoke test all green), merged to `main` as `414a65a`, tag `v4.2.1` pushed, publish run 38596758870 green; release [Dentiva Pro 4.2.1](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v4.2.1) with `DentivaPro-Setup-4.2.1.exe` (100 055 290 bytes, sha256 `d03e9523…f490b`) and `SHA256SUMS.txt` |

## 6. Release status — closed

The v4.2.1 release is published: tag `v4.2.1` → `414a65a` on `main` (parents `06831e3` = main's
v4.2.0 release, `84009c2` = this branch's hardening commit), assets verified. No further action is
required for this release. If work resumes on this branch, start by reading §4 (audit findings) and
`docs/KNOWN_LIMITATIONS.md`, and re-derive the current version from `package.json` before tagging —
the tag must always match it and the branch version must be ahead of the last published one
(currently 4.2.1).
