# Dentiva Pro v5 — Phase 0 baseline audit

Recorded **2026-10-15** before any v5 change. Everything below was observed in this session. Nothing is
inferred from earlier reports unless the text says so.

## 1. Repository and branch state

| Item | Observed value |
| --- | --- |
| Repository | `kshohanservice-glitch/Dentiva-Windows-Application` (public; viewer permission ADMIN) |
| Default / stable branch | `main` @ `303712e489d9747bf6769ce1fd7f3705f5604883` — "Merge pull request #41 …" (release 4.2.3) |
| Baseline tag | `v4.2.3` → `303712e` (same commit as `main`) |
| Latest published release | **Dentiva Pro 4.2.3**, tag `v4.2.3`, published 2026-10-15T10:05:31Z, assets `DentivaPro-Setup-4.2.3.exe` (100,055,216 bytes) and `SHA256SUMS.txt` (94 bytes) |
| `package.json` version | `4.2.3`, database schema version (`PRAGMA user_version`) **7** (migrations 001–007) |
| Remote branches | `main` (303712e), `arena/v5-premium-flagship` (303712e — **no commits beyond `main`**) |
| Branch protection | `main` reports `protected: false` (protection-rule detail endpoint is not readable by this token) |
| Open PRs / issues | none open; no issues exist |
| Closed, unmerged PR relevant to v5 | **#42** "Dentiva Pro 4.3.0 — A4-only printing …", head `272cd9c` on a deleted branch, closed 2026-10-15T10:51:48Z without merge (fetched locally as `origin/pr-42`) |
| Tags | 22 (`v1.0.0` … `v4.2.3`, plus `demo-v1.1.2`, `demo-v3.0.1`) |

### 1.1 v5 development branch decision

The brief prefers a branch named `v5/premium-flagship`. This Arena session is bound to the branch
`arena/8ba688c2-dentiva-windows-application`. The platform requires every commit, push and pull request to go
there, and the branch cannot be renamed. That branch is therefore the isolated v5 development branch. It
was created from `main` at `303712e` and started with a clean worktree.

The existing remote branch `arena/v5-premium-flagship` was inspected. It points at `303712e`, the same commit
as `main`, so it holds no v5 work. It was not reused, reset or deleted. `main` is never committed to from this
branch, and nothing is merged or released without authorisation.

### 1.2 Prior v5-relevant work: PR #42

PR #42 implemented A4-only printing (`src/shared/print-page.ts`, migration `008_a4_only_printing`,
main-process A4 enforcement for print and Save-as-PDF, Settings/PrintPage changes, a v4.2.2 upgrade fixture,
19 new tests and a PDF geometry mode for the layout harness). It also fixed a harness defect that this audit
reproduced independently (V5-021). The owner closed it unmerged, and no reason is recorded.

**Decision:** its commits are reused on the v5 branch through an explicit `--no-ff` merge, so the history stays
attributable. They are then corrected where they conflict with the v5 brief:

- PR #42 deletes customised non-A4 profiles. v5 converts them instead (V5-022).
- PR #42 detects legacy profiles partly by name, which can delete a legitimate A4 profile whose name contains
  "custom" (V5-023).
- PR #42 bumps the version to 4.3.0. v5 releases as 5.0.0 instead.

The merge is recorded in `ISSUE_REGISTER.md` and `../../V5_PROGRESS.md`. Nothing from PR #42 is claimed as
verified until it has been re-run on this branch.

## 2. Application inventory (static)

| Area | Count / location |
| --- | --- |
| Tracked files | 244 (~53k lines including `package-lock.json`) |
| Main process | `src/main` — entry `index.ts`, IPC router `ipc/router.ts` (540 lines), 25 service modules, core (activation, passwords, session, sequences, validate), `print.ts`, `db/` (7 migrations) |
| Preload | `src/preload/index.ts` — builds one bridge method per allow-listed channel from `src/shared/ipc.ts`; bundled by esbuild (sandboxed preload) |
| IPC surface | 137 `IPC` constants: 135 invoke channels + 2 event channels; **every invoke channel has exactly one handler** (verified by script) |
| Channels with no renderer caller | `prescriptions/save-template`, `appointments/get`, `attachments/rename` (backend-only capabilities, kept for parity) |
| Permission keys | 42 (`src/shared/permissions.ts`), 7 built-in roles + custom roles + per-user grant/revoke overrides |
| Renderer routes | 19 shell routes + `#/print/<kind>/<id>` print window + login / setup / lock phases (`src/renderer/App.tsx`) |
| Printable kinds | invoice, receipt, prescription, prescription-duplicate, visit-summary, appointment-card, stock-labels, report (14 report types), quick (walk-in: prescription, invoice, receipt, visit summary, appointment card) |
| Reports | 14 (`src/shared/reports.ts`), each with a permission key |
| Tests | 23 unit + 25 integration Vitest files; 2 Playwright Electron specs (25 tests) that run on Windows CI only |

## 3. Environment (this sandbox)

Debian 12 x86_64, 2 vCPU, 3.8 GiB RAM, Node v22.22.3, npm 10.9.8.

- **No Windows, Wine, Xvfb or display server.**
- The Electron binary cannot be downloaded here. `github.com` redirects to `objects.githubusercontent.com`,
  which is not reachable, so Electron E2E, installers and packaged smoke tests cannot run locally.
- A headless **Chromium 153** is available locally (`@sparticuz/chromium`, installed outside the repository in
  `/tmp/chromium-tools`). It drives `scripts/layout-audit.mjs` against the production renderer bundle and can
  produce PDFs for geometry checks. This is a browser stand-in, **not** the Electron runtime.
- Windows-only gates are verifiable only through GitHub Actions `CI`. It triggers on pushes to `arena/**`
  except docs-only pushes; it runs verify, Electron E2E, then NSIS + silent install + smoke + SHA-256.
- No physical printer exists here. Physical print output is **not** verifiable.

## 4. Baseline checks executed (commit `303712e`, unmodified)

| Check | Command | Result |
| --- | --- | --- |
| Install | `npm_config_nodedir=/usr/local npm ci --force --no-audit --no-fund` | exit 0, 608 packages. `--force` is required because `@node-rs/argon2-win32-x64-msvc` is a Windows-only dependency. 8 deprecation warnings (rimraf@2, glob@7/10, inflight, boolean, eslint@9.39). Electron binary download **failed** (network) |
| Typecheck | `npm run typecheck` (main + renderer projects) | exit 0 (16 s) |
| Lint | `npx eslint .` | exit 0, 0 problems |
| Unit + integration | `npx vitest run` | exit 0 — **48 files, 549 tests passed**, 0 skipped, 23 s |
| Build | `npm run build` | exit 0. Renderer: one JS chunk **586,566 B**, CSS 67,879 B; Inter Cyrillic/Greek/Vietnamese font subsets are also emitted |
| Prod dependency audit | `npm audit --omit=dev --audit-level=moderate` | exit 0, **0 vulnerabilities** |
| Full dependency audit | `npm audit` | exit 1 — **8 moderate**, all one chain: `sprintf-js` (GHSA-hp3w-g68c-fv3c, no fixed version) ← roarr ← global-agent ← @electron/get ← app-builder-lib/electron-builder. Build-time only, not shipped |
| Layout harness | `LAYOUT_BROWSER=… node scripts/layout-audit.mjs` | exit 0, "0 of 144 screen/viewport pairs". **Caveat V5-021:** the print-preview probe measured an error card ("paged is not defined"), not a document |
| Electron E2E / NSIS / installed smoke | — | **Not executable here.** No CI run exists for `303712e` or tag `v4.2.3` (API: 0 runs, 0 check runs). The last green CI on `main` is run 38715381812 at `bbb6d43` |

Raw logs: `/tmp/v5-logs/baseline-*.log` (sandbox only, not committed). Baseline screenshots were taken at six
viewports (144 images) and were reviewed for the redesign. They are not committed.

## 5. Architecture observations

- **Process model.** The renderer runs with `contextIsolation`, `sandbox: true`, `nodeIntegration: false`, a
  strict CSP (`connect-src 'none'`, no remote scripts) and permission requests denied. The preload exposes a
  typed method per channel. The router wraps every handler with `{ok, data | error}`, a correlation id and AUTH
  broadcast.
- **Authorisation.** `requirePermission` is called inside the service layer. `SessionManager.require()`
  reloads the user and permissions on every call, so role changes take effect immediately. The reload ignores
  account `status`, though (V5-002).
- **Database.** better-sqlite3 runs synchronously on the Electron main thread: WAL, `foreign_keys=ON`,
  `busy_timeout=8000`, forward-only migrations each in their own transaction, and `quick_check` on open. There
  is **no pre-migration copy** (V5-007).
- **Money.** Amounts are integer paisa with a shared integer formatter. `billing-math.ts` is shared by stored
  invoices and walk-in invoices. Paid and due amounts are derived from payments.
- **Printing.** A print BrowserWindow loads `#print/<kind>/<id>`, and data comes through permission-gated IPC.
  Geometry comes from profiles (A4 / A5 / custom / thermal-filtered) through an `@page` rule with zero margin,
  plus padding. Main-process `print`/`printToPDF` take the dimensions supplied by the renderer (V5-020).
- **Styling.** Hand-authored tokens (`tokens.css`) plus `global.css` (1,556 lines), `print.css` (856) and
  `documents.css`. A dark theme, a compact density, and reduced-motion and animation-off switches already
  exist. A shell-wide `text-transform: capitalize` title-cases every sentence (V5-030).

## 6. Risks carried into v5

1. **Upgrade data safety.** v5 adds at least one migration, and real clinics upgrade in place. Mitigation:
   pre-migration snapshot (V5-007), fixture-based upgrade tests from v3.0.3, v4.2.2 and v4.2.3, and idempotent
   migrations.
2. **Visual redesign vs. regression tests.** Many tests assert on source text and CSS, and the E2E suite
   selects by accessible name. The redesign must keep accessible names stable or update tests deliberately
   with evidence.
3. **Windows-only verification.** Electron E2E, packaging and installed smoke tests run only in CI, and every
   commit that changes code needs its own CI run.
4. **Physical printing.** It cannot be verified here and remains a documented manual release check.
5. **Provenance of v4.2.3.** It cannot be re-verified from CI records (V5-040). v5 must not inherit that gap.

## 7. Next action

Phase 1: a full audit that extends `ISSUE_REGISTER.md`. Then Phase 2: security and data safety, starting with
the P1 items.
