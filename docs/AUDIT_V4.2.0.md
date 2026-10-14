# Dentiva Pro 4.2.0 — repository audit

## Scope

Reviewed prescription medicine entry in the registered-patient and Walk-in flows, C/C and O/E
choices, optional medicine instructions and their printed representation, invoice-entry wording,
Customize Documents watermark settings/rendering, settings save behavior, form accessibility, and
migration/data preservation. Existing invoice and payment calculations were treated as verified
behavior and were not intentionally changed.

## Findings and disposition

| Area | Finding / risk | Change and regression evidence |
| --- | --- | --- |
| Medicine-entry consistency | The two prescription paths had different entry UI, making supported fields and optional directions harder to compare. | Added `MedicineEntryEditor`, used by both workflows. Existing structured fields and clinician-entered values remain available. |
| Walk-in clinical choices | The Walk-in form lacked shared C/C and O/E choice sets. Fixed choices alone could also block patient-specific wording. | Added shared clinical options with an **Other** manual-entry path. Covered by `tests/unit/clinical-options.test.ts` and Walk-in validation tests. |
| Optional medicine instruction | A free-text line needed to survive validation, persistence, and printing without being silently trimmed or printed alongside conflicting structured directions. | Added optional verbatim instruction handling and nullable migration 007. Printing uses the one-line instruction instead of structured dosing directions when present, while retaining medicine/generic information. Registered prescriptions persist both forms of input; Walk-in remains transient. Regression: `tests/integration/prescription-medicine-instruction.test.ts`. |
| Existing prescription data | Adding a field must not rewrite historic prescription items. | Migration 007 only adds `medicine_instruction TEXT` when missing; it does not update existing rows. Integration coverage checks preservation and round-trip behavior. |
| Invoice-entry semantics | A line discount, invoice-wide discount, received amount, and invoice total can be confused without clearer copy. | Main and Walk-in forms label the discounts separately; Walk-in labels the amount received now and its effect on balance due. No invoice arithmetic or payment-ledger calculation was intentionally changed. Existing quick-document tests remain in `tests/unit/quick-documents.test.ts`. |
| Logo watermark | Clinics need an optional, predictable watermark without changing existing output by default. | Added a disabled-by-default setting using the configured clinic logo. Size is bounded in physical page units, aspect ratio is intrinsic, and the overlay is centered in the printable page. `tests/unit/document-watermark.test.ts` covers defaults, normalization, supported types, page geometry and bounds. |
| Settings logo state | A saved settings response or removed logo could leave the form showing stale local preview data. | Settings form refreshes from the saved response and clears the removed logo preview. |
| Form accessibility | Several reusable and page-level controls needed dependable labels/names. | Added consistent `Field` associations and accessible names across reviewed forms; regression coverage is in `tests/unit/document-forms-a11y.test.ts`. |
| Offline/data handling | Features must not add cloud dependencies or alter unrelated clinic records. | No runtime dependency or network service was added. Watermark preferences use existing settings storage; the only database change is the additive prescription-item column. |

## Automated verification in this checkout

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed after the latest changes. |
| `npm run lint` | Passed. |
| `npm run build` | Passed: main/preload and renderer production builds. |
| `npm test` | 46 files / 482 tests passed. The command logged an Electron binary download `TypeError: fetch failed`; Vitest nevertheless completed with exit code 0. This is not evidence of a successful Electron E2E run. |
| `npm audit --omit=dev` | 0 production dependency vulnerabilities reported. |
| Full `npm audit` | 8 moderate development-tree findings; no high or critical findings after locking `http-cache-semantics` 4.3.0 and `source-map-js` 1.2.2. The `electron-builder` audit recommendation to downgrade below the project's declared range was not applied. |
| `git diff --check` | Passed on the current checkout. |
| Electron E2E / Windows package / installed-app smoke | Not run locally. The Electron binary is absent and could not be downloaded in this sandbox; this is Linux x86_64 without Wine or NSIS/makensis. Windows CI remains the release gate. |
| Physical printer / clinic device | Not tested. Requires a Windows clinic device and printer. |

## Release state

The previous published release is **4.1.2**. This work targets **4.2.0** because it adds compatible user-facing features. Version 4.2.0 is a candidate until its PR's Windows verification and the tag-gated release pipeline have actually passed. No unobserved CI result, tag, installer, checksum, or release is claimed here; the final outcome belongs in `docs/PROGRESS_V4.2.0.md` and a release report after the pipeline completes.
