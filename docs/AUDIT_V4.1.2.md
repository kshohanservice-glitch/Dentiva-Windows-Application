# Dentiva Pro — v4.1.2 repository audit

Scope: wiring, IPC surface, links/imports/assets, dead and duplicated code, SQLite integrity,
Electron security, Windows behaviours, print/PDF path, and the two v4.1.2 features.

Method: every finding below was produced by a command or a test that ran against this checkout
(`arena/ed773b64-dentiva-windows-application`). Findings that could not be reproduced are not
listed. Items that were **not** verifiable in this environment (Electron runtime, Windows
installer, physical printing) are listed as explicitly unverified in §6 — they are not claimed.

Severity: `high` = data loss / security / wrong money · `medium` = broken or misleading behaviour ·
`low` = hygiene.

---

## 1. Verified defects found and fixed

| ID | Area | Sev | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| AUD-412-01 | Document customization | high | The generated override stylesheet appended a single `!important` **after the whole declaration list** (`.print-doc [data-doc-el=…] { color: #000; font-size: 48px !important; }`). In CSS only the declaration immediately before `!important` is important, so a clinic's colour/spacing choices were losing to `print.css` without any visible error — the feature would have appeared to "not save" for some properties. | `tests/unit/document-styles.test.ts` "translates every supported property into CSS" failed against the first implementation; the emitted rule showed `color: #000000; … !important`. | `cssDeclarations()` now emits `!important` **per declaration** (`shared/document-styles.ts`); the test asserts `property: value !important` for all 22 properties. |
| AUD-412-02 | Document customization | medium | Optional elements (`…clinicNameBn`, `…dentistLabel`, footer note, signature label, logo …) declared `optional: true` but did not declare the `visible` property, so the "hide this element" control could never appear for them and the registry/renderer invariant was unenforced. | `normalizeElementStyle({props: ['fontSize'], optional: true}, {visible: false})` returned `undefined`; registry dump showed `visible` missing from 15 optional elements. | `el()` in `shared/document-styles.ts` now adds `visible` to any element declared optional; `tests/unit/document-layout.test.ts` asserts the invariant in both directions (only optional elements offer visibility, every optional element offers it). |
| AUD-412-03 | Walk-in quick documents | medium | A quick prescription could be prepared with a `dentistId` that no longer exists (dentist deleted after the form was opened). The header then fell back to the literal `Dentist` — an unsigned prescription with no named prescriber, i.e. a legally incomplete document. | Adversarial case added in `tests/integration/document-customization.test.ts`: `prepareQuickDocument(…, {dentistId: 9999})` produced a document instead of an error. | `resolveDentist()` resolves the dentist from the database and **throws** `The selected dentist no longer exists. Choose another dentist or type the name.` when it cannot; ownership of the credentials stays in the main process. |
| AUD-412-04 | Walk-in quick documents | low | A dentist selected from the clinic list still demanded a typed name (`Dentist name is required.`), which contradicts the credentials already stored on the dentist record and would have produced a confusing validation dead-end. | Same integration test: selecting a valid dentist with an empty text field failed validation. | `dentistName` is required only when no dentist was selected; the renderer marks the field required under the same condition. |
| AUD-412-05 | Electron security | medium | The **print window** (which renders patient documents) did not set `setWindowOpenHandler`/`will-navigate` guards, while the main window did. A document is data, never a navigation target; without the guard any future link or `window.open` inside printed content would have reached the default Electron behaviour. | `src/main/index.ts` had both guards; `src/main/print.ts` had neither (`grep -n "setWindowOpenHandler\|will-navigate" src/main/*.ts`). | The print window now denies window-open and blocks navigation away from `file://`, matching the main window. Covered by the existing E2E that opens the print window. |
| AUD-412-06 | Test integrity | medium | `tests/unit/print-money.test.ts` asserted the masking contract against `src/renderer/pages/PrintPage.tsx`. Once the renderers moved to `src/renderer/documents/print-documents.tsx`, the assertion silently parsed a file that no longer renders documents (`0 > 0` failure). | Suite run: 2 failures in `print-money.test.ts` after the renderer extraction. | The assertion now targets the module that actually renders (`documents/print-documents.tsx`); the contract itself (real amounts, never `****`, `printable` mode only) is unchanged and still enforced. |
| AUD-412-08 | Walk-in quick documents | medium | The new form rendered `Field` children as `{() => <Input …/>}`, ignoring the id the primitive generates, so every label pointed at a non-existent control. The fields were unusable for a screen reader, unreachable by the label-based selectors the project's own E2E suite uses, and the Windows E2E job failed with `locator.fill: Timeout 30000ms exceeded` on the first field. The audit could not rely on local gates alone for this defect: it was found by the Windows CI run. | CI run for the implementation commit: `Electron E2E (Windows)` failed; annotations reported the fill timeout in `app.spec.ts` walk-in test. | All 30 controls in `QuickDocuments.tsx` now receive `{(id) => <Control id={id} …/>}` (the convention already used by the patient screens) and the Customize Documents panel associates its labels the same way. `tests/unit/document-forms-a11y.test.ts` renders both real screens and requires every `for="…"` to resolve to a matching `id="…"`, so the class of defect cannot return. |
| AUD-412-07 | Dead code (new) | low | The sample-data module exported three identifiers (`SAMPLE_CLINIC`, `SAMPLE_SETTINGS`, `SAMPLE_DENTIST`) that nothing referenced, and `styleOverride()` was unused by the editor that was supposed to consume it. | Export-usage scan over `src/**` + `tests/**` reported both as unreferenced. | Removed the unused exports; `CustomizeDocumentsPanel` now reads element overrides through `styleOverride()` so the helper has a single caller and the intent is explicit. |

---

## 2. Verified-clean areas (checked, no defect found)

| Area | Check | Result |
| --- | --- | --- |
| IPC wiring | Parse `IPC` map (137 channels) vs `handle(IPC.…)` in `src/main/ipc/router.ts` | Every declared channel has a handler; no handler exists for an undeclared channel; the renderer's `api['…']` calls all name declared channels. |
| Print/PDF geometry | `profilePageCss` + `PrintPage` inline geometry + `executePrint`/`saveAsPdf` | Unchanged. `@page size` is the single source of page geometry; native margins stay `none`; the new customization stylesheet adds **no** geometry of its own. |
| SQLite integrity | `PRAGMA integrity_check` / `foreign_key_check` / `user_version` / `foreign_keys` / `journal_mode` on a freshly migrated database | `ok`; 0 violations; `user_version = 6`; `foreign_keys = 1`; WAL; 41 tables. |
| Migration safety | New feature adds **no** migration | Customizations are stored as JSON in the existing `settings` key/value table under the key `documentStyles`; a database written by 4.1.1 opens unchanged, and 4.1.2 data opens in 4.1.1 (the unknown key is ignored). |
| Electron security posture | `webPreferences` of every `BrowserWindow`; renderer CSP | Main and print windows: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, dedicated preload. CSP: `default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'`. The generated customization stylesheet is an inline `<style>` element, already permitted by `style-src 'unsafe-inline'`; it contains no URL, no `@import` and no expression. |
| Element styling is containment-safe | CSS generator | Selectors are `.print-doc [data-doc-el="<id>"]` (+ ` th`/` td` for cell groups). No selector can match outside a printable document; no rule targets `body`, `.shell` or a page class. Tested. |
| Calculations untouched | Shared invoice arithmetic vs stored invoice path | `shared/billing-math.ts` is now the single implementation for both; the service stores `subtotal` and `subtotal − total`. `tests/unit/billing-math.test.ts` + the existing billing integration tests pin the stored values. |
| Money masking | Print path | Unchanged: `PrintMoney`/`FormattedMoney(printable)` only; no `Money` import in the document tree. |
| Permission enforcement | Quick-document service | Both the *create* permission and the *print* permission of the kind are enforced in the main process (`requirePermission`), not only in the UI. Tested with limited sessions. |
| Absolute Windows paths | Changed files | The new code contains no path handling; nothing writes outside the existing data directory. |
| Imports and assets | `npm run build` (main + renderer) and `tsc --noEmit` for both projects | Every import in the changed and new modules resolves; no dynamic asset path was introduced. Fonts stay bundled (`@fontsource`), icons stay inline SVG, and the only image a document can reference is the clinic logo already stored under `<dataDir>/branding/`. The added screen-only stylesheet is imported from `main.tsx` and therefore bundled, not fetched. |

---

## 3. Duplication

| Item | Before | After |
| --- | --- | --- |
| Document renderers | Eight renderers plus header/footer/DTO adapters lived inside `PrintPage.tsx` (809 lines), reachable only from the print window. Any second consumer (walk-in documents, settings preview) would have had to fork the templates — the classic source of "the preview doesn't match the paper". | Extracted to `src/renderer/documents/print-documents.tsx` (single rendering path, used by the print window, the Customize Documents preview and the walk-in preview). `PrintPage.tsx` is now 341 lines of page/toolbar/profile logic. |
| Layout-regression evidence | none | `tests/unit/document-layout.test.ts` renders every document through both the frozen pre-4.1.2 implementation (`tests/fixtures/legacy-print-documents.tsx`, generated from commit `58375e0`) and the current renderers and requires identical markup; `data-doc-el` (added by the feature) is asserted to be the *only* difference, and it carries no style. |

---

## 4. Dead code (report only, deliberately not deleted)

`src/**` exported symbols with no reference outside their own file were enumerated. 50 of them are
pre-existing design-system or validation helpers (for example `Checkbox`, `RadioGroup`, `Chip`,
`Dropdown`, `CURRENCY_SYMBOL`, `normalizePhone`). They are exported API of their module, several
are used inside their own file, and static-analysis "unused" status is not evidence that runtime,
dynamic or packaging use does not exist — per the release rules they are **reported, not removed**.

Three IPC channels are handled and permission-gated but not referenced by the renderer today:
`appointments/get`, `attachments/rename`, `prescriptions/save-template`. Their services have test
coverage and they remain part of the documented IPC surface; deleting them would remove working,
reachable-from-a-future-screen capability, so they are recorded here as an observation.

---

## 5. Windows-specific behaviour

| Behaviour | Status |
| --- | --- |
| OS secure storage (`safeStorage`) required before touching the database | Unchanged (see `src/main/index.ts`) — a packaged Windows install fails closed with an actionable message instead of migrating data it cannot protect. |
| Single-instance lock, second-instance focus | Unchanged. |
| NSIS artefact naming and the version-matched installer check | Unchanged; the release job still verifies `dist/DentivaPro-Setup-<version>.exe`, its SHA-256 and the packaged Argon2 binding. |
| Icons | `build/icon.ico` + `build/icon.png` present; `npm run icons` regenerates them. |
| Paths | Everything uses `app.getPath`/`AppPaths`; no new file or directory is created by v4.1.2. |

---

## 6. Explicitly unverified in this environment

These are **not** claimed as tested. The sandbox is Linux with no Electron binary and no printer.

1. Electron runtime behaviour of either feature (window opening, print dialog, `printToPDF`
   content). `npm run test:e2e` cannot run here; CI (`windows-latest`) runs it on every push.
2. The NSIS installer build, its silent install, the installed-application smoke test and the
   published release assets. These are produced only by the tag-gated CI job.
3. Physical print output: DPI, paper sizes, Bengali glyph shaping, and whether a *user-chosen*
   large font can push a wide table onto a second page. The customization ranges are deliberately
   bounded (font size ≤ 48 px, padding ≤ 24 px) and column widths are percentages, but only a real
   Windows print can confirm a specific clinic's configuration.
4. Long-value clipping with the sample data used in tests is covered structurally
   (`tests/unit/document-layout.test.ts` renders the tables with realistic values); visual clipping
   on paper is not.

---

## 7. Feature coverage decisions (and their limits)

**Customizable documents — 7 registry types.** `prescription` (which also covers the duplicate
copy printed with a watermark, and quick prescriptions), `invoice` (stored and quick),
`receipt` (invoice receipt and quick receipt), `visit-summary` (stored visit summary and quick
examination report), `appointment-card` (stored and quick), `stock-labels`, `report`.
`tests/unit/document-layout.test.ts` proves there is no declared-but-unrendered element and no
rendered-but-undeclared marker for any of them.

**Walk-in documents — 5 kinds.** Prescription, invoice, receipt, examination report (visit summary)
and appointment card. These are the documents that exist *for a patient*, which is what a walk-in
customer needs. Inventory labels and clinic reports are deliberately **not** offered here: they are
aggregate/sheet documents with no customer, they are already reachable from Inventory and Reports,
and reproducing them in a customer-centric workflow would have been scope bleed rather than reuse.
The limitation is stated in the product copy for each kind (for example: "A quick invoice is not
recorded in the books and does not use an invoice number").

**Known, documented limits of the walk-in workflow.**

1. A quick document is transient by design: it is held in the main process for two hours (maximum
   24 documents, oldest evicted first) and is discarded when the app quits. The operator is told
   this in the screen copy; the printed page or saved PDF is the record.
2. Quick documents never appear in the day book, patient history, payment ledger, schedule or any
   report — there is no partial/implicit linkage to create. Converting a walk-in customer into a
   patient is an explicit action on the patient screens.
3. The quick forms intentionally expose the clinical/line-item fields of the stored forms rather
   than the full stored form: patient-history, tooth-chart, template-selection and attachment
   features have no meaning without a patient record. Validation, arithmetic, layout and print
   output are shared with the stored path in all cases.
