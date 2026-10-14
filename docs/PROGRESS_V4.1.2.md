# Dentiva Pro v4.1.2 — durable progress log

This file is the interruption-recovery record for the v4.1.2 development effort. It is updated
after every meaningful milestone. A task is only marked **done** when its result has been
observed, not when it was started.

## 0. Branch / commit policy for this release

- Development branch: `arena/ed773b64-dentiva-windows-application` (this Arena session's branch —
  the branch name is session-fixed and cannot be renamed). It is branched from `main` at
  `58375e0dac670cf2a511a5a0eab543d32dbfc4ce` and is pushed to `origin` under the same name.
- All v4.1.2 work happens on this branch; the release is published from a commit that is on
  `main` (CI enforces `git merge-base --is-ancestor` against `main` before publishing).

## 1. Baseline (recorded before any source change)

| Item | Value |
| --- | --- |
| Starting commit | `58375e0dac670cf2a511a5a0eab543d32dbfc4ce` (merge of PR #27 on `main`) |
| Working tree | clean |
| `package.json` version | `4.1.1` |
| Existing tags | `v4.1.1` only (`v3.0.3`, `v4.0.0`, `v4.1.0` referenced in docs; not present in this checkout) |
| Schema version | 6 (migrations `001_init` … `006_whatsapp`) |
| Test suite | Vitest: **37 files / 375 tests — all passing** (`npm test`, 12.28 s) |
| Typecheck | `tsc -p tsconfig.node.json --noEmit` → 0; `tsc -p tsconfig.renderer.json --noEmit` → 0 |
| Lint | `npx eslint .` → 0 (no output) |
| Production audit | `npm audit --omit=dev --audit-level=moderate` → 0 |
| Build | `npm run build` (main + renderer) → clean |
| Electron E2E | **not runnable in this sandbox** (Electron binary intentionally not downloaded; Linux container has no display). Windows CI (`windows-latest`) is the installer/E2E gate. |

Install command that works in this sandbox (the repo pins a Windows-only optional dependency and
`node-gyp` cannot fetch headers here):

```
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --force --ignore-scripts
```

`better-sqlite3` 13.x ships its own `prebuilds/` inside the npm tarball, so the SQLite-backed
integration tests run here without compilation.

## 2. Printable-document inventory (baseline, before changes)

Print entry point for every kind is the print window: `reports/print` → main process
`openPrintWindow()` → renderer at `#print/<kind>/<id>?…` (`src/renderer/pages/PrintPage.tsx`),
which loads data over authenticated IPC and renders into `.print-doc`.

| Kind | Creation / data source | Renderer | Print + PDF |
| --- | --- | --- | --- |
| `prescription` | Patient profile → New prescription (`RxFormModal`, Patients.tsx) | `prescriptionDoc` | print window (Print / Save PDF) |
| `prescription-duplicate` | Patient profile → duplicate copy | `prescriptionDoc` + watermark | print window |
| `invoice` | Invoices page / patient profile (`InvoiceFormModal`) | `invoiceDoc` | print window |
| `receipt` | Invoice detail → receipt | `receiptDoc` | print window |
| `visit-summary` | Patient profile → visit summary | `visitSummaryDoc` | print window |
| `appointment-card` | Appointments | `appointmentCardDoc` | print window |
| `stock-labels` | Inventory page | `stockLabelDoc` | print window |
| `report` | Reports page | `reportDoc` | print window |

## 3. Task board

| Task | Status |
| --- | --- |
| Repository inspection + baseline capture | done |
| Durable progress log | done |
| Baseline document markup fixtures (pre-change) | done — `tests/fixtures/legacy-print-documents.tsx` generated from `58375e0` |
| Feature A — Customize Documents (settings section, engine, persistence, live preview) | done (implementation) — see §4 |
| Feature B — Walk-in / Quick Documents (sidebar, forms, print, PDF, no WhatsApp) | done (implementation) — see §5 |
| Codebase audit + fixes | done — `docs/AUDIT_V4.1.2.md` (7 verified defects fixed, 3 clean areas confirmed) |
| Tests (unit / integration / layout regression) | done (local) — 42 files / 468 tests passing |
| Docs + version bump to 4.1.2 | done — `docs/AUDIT_V4.1.2.md`, `docs/RELEASE_NOTES_4.1.2.md`, PRINTING/ARCHITECTURE updated, `package.json` = 4.1.2 |
| Final gates + PR + tag `v4.1.2` + released installer | in progress — see §6 |

## 4. Feature A — Customize Documents (what was built)

| Piece | File |
| --- | --- |
| Registry, validation, CSS generation, reset helpers | `src/shared/document-styles.ts` |
| Single rendering path for every printable document (118 `data-doc-el` markers) | `src/renderer/documents/print-documents.tsx` |
| Generated stylesheet element (renders nothing when empty) | `src/renderer/documents/document-style-sheet.tsx` |
| Settings panel (element tree, controls, live preview, scoped reset) | `src/renderer/components/customize-documents.tsx` |
| Real-renderer preview + sample content | `src/renderer/documents/document-preview.tsx`, `src/renderer/documents/samples.ts` |
| Persistence | `documentStyles` key via `src/main/services/settings.ts` (`SettingsDTO.documentStyles`) |
| Screen-only styles | `src/renderer/styles/documents.css` |

Seven document types, 75 elements, 22 supported properties. Untouched configuration emits no CSS,
and `tests/unit/document-layout.test.ts` proves the default markup is byte-identical to the frozen
pre-4.1.2 renderers (markers stripped) for all seven types.

## 5. Feature B — Walk-in / Quick Documents (what was built)

| Piece | File |
| --- | --- |
| Payload model, bounds, validation, references, file names | `src/shared/quick-documents.ts` |
| Transient store + permission enforcement + audit | `src/main/services/quick-documents.ts` |
| IPC (`quick-documents/prepare`, `quick-documents/payload`) + `#print/quick/<token>` route | `src/shared/ipc.ts`, `src/main/ipc/router.ts`, `src/main/print.ts`, `src/renderer/pages/PrintPage.tsx` |
| Page (5 document kinds, preview, print/PDF) + sidebar entry + route | `src/renderer/pages/QuickDocuments.tsx`, `src/renderer/components/shell.tsx`, `src/renderer/App.tsx` |
| Adapter to the shared document builders | `src/renderer/documents/quick-document-view.tsx` |
| Shared invoice arithmetic (also used by the stored-invoice service) | `src/shared/billing-math.ts` |

Five kinds; zero database writes outside one audit entry; zero WhatsApp surface (source-level test);
permissions enforced in the service layer for both create and print.

## 6. Milestone log

| # | Milestone | Evidence |
| --- | --- | --- |
| 1 | Baseline captured on `58375e0` | 37 files / 375 tests, typecheck + lint + build clean; recorded in §1 |
| 2 | Frozen pre-change renderer fixture | `tests/fixtures/legacy-print-documents.tsx` (generated from git, blob hash in the header) |
| 3 | Feature A core + tagging + extraction | `tsc` clean; `tests/unit/document-layout.test.ts` 18 tests green |
| 4 | Feature A UI + persistence + print wiring | `tests/unit/document-styles.test.ts` (30) + `tests/integration/document-customization.test.ts` (14) green |
| 5 | Feature B model + main service + IPC + page | `tests/unit/quick-documents.test.ts` (17) green |
| 6 | Shared billing arithmetic | `tests/unit/billing-math.test.ts` (14) green |
| 7 | Audit + fixes | `docs/AUDIT_V4.1.2.md` |
| 8 | Full local gates | 42 files / 468 tests, `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit --omit=dev` → all clean |
| 9 | Version + notes | `package.json` / `package-lock.json` = 4.1.2; `docs/RELEASE_NOTES_4.1.2.md` |
| 10 | Commit + push + PR | see §7 (updated with the commit SHA) |
| 11 | Windows CI (verify / E2E / NSIS + installed smoke test) | see §7 |
| 12 | Tag `v4.1.2` on the verified commit → release published | see §7 |

## 7. Release status

Implementation, tests and documentation are complete; the release is published only from a commit
that has passed the Windows pipeline. This section is updated with the exact run, commit, tag and
asset identifiers as each step completes:

| Item | Value |
| --- | --- |
| Branch | `arena/ed773b64-dentiva-windows-application` |
| Implementation commit | _recorded on push_ |
| CI run | _pending_ |
| Tag `v4.1.2` | _pending_ |
| Installer asset + SHA-256 | _pending_ |
