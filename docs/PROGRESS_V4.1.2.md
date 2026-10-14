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
| Baseline document markup fixtures (pre-change) | pending |
| Feature A — Customize Documents (settings section, engine, persistence, live preview) | pending |
| Feature B — Walk-in / Quick Documents (sidebar, forms, print, PDF, no WhatsApp) | pending |
| Codebase audit + fixes | pending |
| Tests (unit / integration / layout regression) | pending |
| Docs + version bump to 4.1.2 | pending |
| Final gates + PR + tag `v4.1.2` + released installer | pending |

## 4. Audit findings

Recorded as they are verified, in `docs/AUDIT_V4.1.2.md`.

## 5. Release status

Not started. Nothing has been tagged, and no release asset has been produced at this point.
