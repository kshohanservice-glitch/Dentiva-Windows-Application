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

## Automated verification

| Check | Result |
| --- | --- |
| Local `npm run typecheck` / `npm run lint` / `npm run build` | Passed. |
| Local `npm test` | 46 files / 482 tests passed. The command logged an Electron binary download `TypeError: fetch failed`; Vitest completed with exit code 0. This is not evidence of a successful local Electron E2E run. |
| Production dependency security audit | `npm audit --omit=dev` reported 0 production vulnerabilities; the tagged CI production audit passed. |
| Full development dependency audit | 8 moderate findings; no high or critical findings after locking `http-cache-semantics` 4.3.0 and `source-map-js` 1.2.2. The `electron-builder` recommendation to downgrade below the project's declared range was not applied. |
| PR CI | [Run 38589247140](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38589247140) passed the Windows release checks after stale accessible-field selectors were corrected. |
| Tagged CI / installer | [Run 38590568540](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38590568540) passed all three jobs: verification/build, Windows Electron E2E, and NSIS packaging plus installed-app smoke. CI verified the Argon2 runtime binding, silent installation, checksum generation, and release publication. |
| Electron E2E / Windows package / installed-app smoke | Not run locally; all three were exercised successfully on the Windows CI runner. The installed-app smoke used a fresh profile, not a clinic's database. |
| Physical printer / clinic device | Not tested. Requires the target Windows device and printer. |
| Release artifacts | GitHub reports the 100,055,048-byte installer asset SHA-256 as `6c3a100e3874a8e9c63bf1db529993aaf8cdc615cac6e2eca3fb10831d716d9b`, matching the successful CI checksum step. The asset was not separately downloaded for a second local comparison. |

## Release state

Dentiva Pro **4.2.0 is released**. PR [#30](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/30)
was merged to `main` on 2026-10-14 at `5af241edab8a3c7c8f66006e5617d9bd8ff93757`. The annotated tag
[`v4.2.0`](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v4.2.0)
points to that commit. The release was published on 2026-10-14 at 15:40:58 UTC and is marked Latest.
Its Windows installer and `SHA256SUMS.txt` are attached to the release. The full evidence and
remaining limitations are in [`PROGRESS_V4.2.0.md`](PROGRESS_V4.2.0.md) and
[`RELEASE_REPORT_V4.2.0.md`](RELEASE_REPORT_V4.2.0.md).

This file was updated as post-release documentation; the tag and shipped artifacts were not moved
or rebuilt.
