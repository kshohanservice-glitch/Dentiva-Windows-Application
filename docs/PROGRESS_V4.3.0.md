# Dentiva Pro 4.3.0 — audit, refactor and release progress log

Durable interruption-recovery record for the 4.3.0 effort. It is updated after every meaningful
milestone. A task is only marked **done** when its result was *observed* (command output, CI run,
measurement), never when it was started. If this session is interrupted, resume by reading this file,
then `git status` / `git log`, then the "Next step" row of §6.

## 1. Branch / baseline (verified, not assumed)

| Item | Verified value |
| --- | --- |
| Working branch | `arena/1ddad382-dentiva-windows-application` (session-fixed name) |
| Baseline commit | `bbb6d43cb4c6dcf1efe82d895b23eaa3b8517ebd` = `origin/main` HEAD ("Merge pull request #40 from … arena/19ed6337…") |
| Baseline state of the checkout | clean working tree at session start; single-commit shallow clone (`git log` shows one commit) |
| Published release used as the product baseline | `v4.2.2` → tag object `aa90da02a40afd35693f8d3c360caf14405c8ffe` ("Prepare Dentiva Pro v4.2.2 release (#36)"), published 2026-10-15T07:55:36Z, assets `DentivaPro-Setup-4.2.2.exe` (100 054 657 bytes) + `SHA256SUMS.txt` |
| **Newer published release observed during this session** | `v4.2.3` (tag → `3c6fe3a2131061f788e47bd78d184a547778fc47`, release commit `b0eb022`, merge `303712e` = `origin/main`), published **2026-10-15T10:05:31Z**, assets `DentivaPro-Setup-4.2.3.exe` (100 055 216 bytes) + `SHA256SUMS.txt`. It contains the §4 layout work from this branch's base commit but **not** this branch's changes. `origin/main` is therefore 3 commits ahead of the branch base; the branch was merged up to `origin/main` (no rebase, no force-push) so the 4.3.0 candidate sits on the released tree |
| `package.json` version at baseline | `4.2.2` (so `main` is *ahead* of the published release: it contains unreleased 4.2.3 layout work) |
| Target version for this effort | `4.3.0` (minor: A4-only printing policy + the width-independent invoice line + audit/harness work). `4.2.2` and `4.2.3` are both published; `4.3.0` is the next unique version after them (`package.json` was bumped `4.2.2` → `4.3.0` in this branch, and the merge-up keeps `4.3.0` over `main`'s `4.2.3`) |
| Files changed by the unreleased 4.2.3 work on `main` | `.gitignore`, `docs/RELEASE_NOTES_4.2.3.md`, `docs/RESPONSIVE_AUDIT_V4.2.3.md`, `package.json`, `scripts/layout-audit.mjs`, `src/renderer/pages/{About,Dashboard,Patients,QuickDocuments,Reports}.tsx`, `src/renderer/styles/{documents,global}.css`, `tests/e2e/{responsive-layout.spec.ts,support.ts}`, `tests/integration/ui-layout-regressions.test.ts` (15 files, +1920/−77 vs `v4.2.2`) |

### Baseline gate results (executed on the baseline commit, this sandbox)

| Check | Command | Result |
| --- | --- | --- |
| Dependency install | `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --force --ignore-scripts` + `npm rebuild better-sqlite3 --nodedir=/usr/local` | installed (608 packages); `@node-rs/argon2-win32-x64-msvc` is win32-only, hence `--force`; `better-sqlite3` built from source because its prebuilt download host is not reachable |
| Typecheck (main) | `npx tsc -p tsconfig.node.json --noEmit` | clean |
| Typecheck (renderer + tests) | `npx tsc -p tsconfig.renderer.json --noEmit` | clean |
| Lint | `npx eslint .` | clean |
| Unit + integration | `npm test` | **48 files / 549 tests passed** |
| Build | `npm run build` (main tsc + preload bundle + vite) | clean |
| Responsive layout harness | `node scripts/layout-audit.mjs --json …` (19 routes × 6 viewports + dialogs + walk-in invoice) | baseline `main`: **0 violations of 144** |
| Electron E2E / NSIS installer | Windows GitHub Actions only | not runnable in this Linux sandbox (no Electron binary, no display). Windows CI on the pushed branch is the applicable gate. |

**Local Chromium for layout evidence.** The sandbox has no Playwright browser
(`~/.cache/ms-playwright` is absent) and the Playwright CDN is not in the network allow-list, so the
harness initially reported "No usable Chromium". A real Chromium 153 binary was obtained from the npm
registry (`@sparticuz/chromium`, decompressed to `/tmp/ch/chromium`, run with
`LD_LIBRARY_PATH=/tmp/ch/libs/lib:/tmp/ch/libs/lib64`) and the repository's own harness — which
documents exactly this `LAYOUT_BROWSER` / `LAYOUT_BROWSER_LIBS` contract — was then executed for every
measurement in this log. Nothing was added to the repository to make this work.

## 2. Reported defect — reproduced on the published baseline

`node scripts/layout-audit.mjs --only quick-documents` against a renderer built from **`v4.2.2`**
(a `git worktree` at the release tag):

| Viewport | Panel (`.quick-line-grid`) | Card | Overflow | Fields |
| --- | --- | --- | --- | --- |
| 1920×1080 | 603px | 629px | **+85px** | one row of five: `Item or procedure 180 · Qty 80 · Unit price 115 · Discount 120 · Line total 145` |
| 1366×768 | 450px | 476px | **+238px** | same five-column row, minimums 640px + gaps |
| 1024×768 | 688px | 714px | 0 | fits only because the window is narrower than the app's minimum |
| 800×600 / 680×900 / 480×800 | 628 / 516 / 316px | | 0 | one field per row (window media queries) |

Root cause: the line grid was a fixed five-column template (minimums ≈ 690px including gaps) whose
only responsive variants were keyed to *window* media queries, while the panel that actually contains
it is 450–630px wide whenever the document preview shares the row (all supported windows ≥ 1180px).
Also reproduced in the same run: the walk-in **examination report** procedure grid overflowed by 71px
at 1366×768 (`Unit price (৳)+71`), the same fixed-template cause.

### And still wrong on the released `v4.2.3`

The base commit of this branch (`bbb6d43`) already contains a first fix: the line reflows from the
width of its own panel, so the overflow is gone. That fix kept a *width-dependent alternative* — one
row of five fields whenever the panel reaches ≈690px — which the required design does not allow. The
harness (with the required row contract, §4) run against a renderer built from the released `v4.2.3`
tag:

| Viewport | Panel (`.quick-line-grid`) | Arrangement | Violations |
| --- | --- | --- | --- |
| 1180×720 (**minimum supported window**, panel 832px) | 832px | **one row of five**: `Item or procedure · Qty · Unit price (৳) · Discount (৳) · Line total (৳)` | 1 |
| 2560×1440 / 1920×1080 / 1366×768 / 1024×768 / 800×600 / 680×900 / 480×800 | 603 / 603 / 450 / 676 / 628 / 516 / 316px | two rows as required | 0 |

So `v4.2.3` no longer clips the fields, but a clinic running it at the minimum window size still gets
the single cramped row — and no automated check prevented that. 4.3.0 removes the alternative
altogether and makes the arrangement a harness/test violation.

## 3. Phases

| Phase | Scope | Status |
| --- | --- | --- |
| A | Baseline + architecture/dependency/workflow inventory | done (§1) |
| B | Layout (reported defect + repo-wide overflow) and A4-only printing | done in-sandbox (code, tests, docs, measurements); Windows-gate items stay in §6 |
| C | Functional, wiring and code-quality audit | pending |
| D | Security, database, dependency audit | pending |
| E | UI/UX and maintainability | pending |
| F | Full regression run | pending |
| G | Windows build / installed smoke / release verification | pending (Windows CI) |

## 4. Changes made (with reasons)

| File | Change | Reason |
| --- | --- | --- |
| `docs/PROGRESS_V4.3.0.md` | created | Mandatory durable recovery record for this effort |
| `src/renderer/styles/global.css`, `src/renderer/pages/QuickDocuments.tsx` | Walk-in invoice line is now one fixed grid at every width: row 1 `Item or procedure · Qty · Unit price (৳)`, row 2 `Discount (৳) · Line total (৳)` (`grid-template-areas`); the `@container (min-width: 690px)` single-row branch and its five-column minimums were deleted | The reported defect (§2): five fields in one fixed-template row overflowed the panel in every supported window |
| `src/shared/print-page.ts` (new), `src/shared/types.ts`, `src/shared/document-watermark.ts` | A4-only page model — `A4_WIDTH_MM`/`A4_HEIGHT_MM`, `a4PageSize()`, `a4PageCss()`, `A4_PAGE_LABEL`, `CANONICAL_PRINT_PROFILES`/`defaultPrintProfiles()`/`withRequiredProfiles()`, `normalizePrintProfile(s)`, `isLegacyNonA4Profile`; `PrintProfile` lost `paperSize`/`widthMm`/`heightMm`; watermark page geometry is orientation-only | A4 is the only size the product prints, so page size is a policy constant, not per-profile data that can drift |
| `src/main/print.ts`, `src/shared/print-page.ts` | `executePrint()` and `saveAsPdf()` now resolve the requested `widthMm`/`heightMm` through the new `asA4PageSize()` helper, so the A4-only policy holds at the main-process boundary (an A4 box keeps its orientation, anything else becomes A4 portrait) instead of trusting the renderer. The native `pageSize` is always sent, never omitted | Phase C finding: the policy was enforced in the renderer only, so a stale or tampered renderer could still hand Electron an A5/thermal page box |
| `src/main/services/settings.ts`, `src/main/print.ts`, `src/renderer/pages/PrintPage.tsx`, `src/renderer/pages/Settings.tsx` | Profile read/write goes through the shared model; `profilePageCss`, the renderer's local paper tables and the receipt fallback were deleted; Settings shows the static A4 label | One source of truth for the `@page` rule; a stored legacy profile can no longer reach it |
| `src/main/db/migrations/008_a4_only_printing.ts` (new), `src/main/db/migrations/index.ts` | Migration 8 `a4-only-printing`: A4 profiles kept verbatim (printer/orientation/margins/scale/copies), page-size keys stripped, document types left without a profile re-seeded, one append-only `system.migrate` audit row, idempotent, no patient/clinical/financial writes | Published 4.2.2 databases must upgrade without silently losing printer or margin choices |
| `scripts/layout-audit.mjs` | Screens mode marks the four resizeable sizes (`supported`) and measures 24 screens × 8 viewports; `--explain`; new `--pdf [dir]` mode: all 13 printable documents rendered in the real print window plus a 3-view landscape pass, `.print-doc` measured in mm, PDFs written with `preferCSSPageSize`, `/MediaBox` parsed, per-route on-screen/console reason captured when a document fails to render | The A4 policy and the layout fix need geometry evidence, not only unit tests |
| `scripts/build-v422-fixture.mjs` (new), `tests/fixtures/v4.2.2/dentiva-v4.2.2.db` (new), `tests/integration/migration-v422.test.ts` (new) | A fixture database built from the **real released v4.2.2 code** (migrations 001–007, `user_version` 7) and seeded with clinic-shaped rows, including the historic A4/A5/80mm-thermal print profiles plus a hand-added custom-millimetre profile; a 6-test upgrade suite asserts the 4.3.0 migration on it (no clinical/financial change, A4-only profiles, audited outcome, idempotent reopen, integrity checks) | The A4-only rewrite had only synthetic-row coverage; a real published-version database is the upgrade a clinic will actually run |
| `src/main/db/migrations/008_a4_only_printing.ts` | Audit summary now distinguishes profiles kept from profiles re-seeded, and stores both id lists (`{kept, seeded, removedNonA4}`) | "N kept" alone was ambiguous once retired mediums are replaced by seeded A4 profiles |
| `tests/unit/print.test.ts`, `tests/unit/document-watermark.test.ts`, `tests/integration/a4-only-printing.test.ts` (new), `tests/integration/migration-v303.test.ts`, `tests/integration/ui-layout-regressions.test.ts`, `tests/e2e/app.spec.ts`, `tests/e2e/responsive-layout.spec.ts` | A4-only unit suite, 13-test policy suite (source gate, stored profiles, migration, legacy detection, write-path normalization), idempotency compared across 8 migrations via `migrationAuditSummaries()`, 37-test layout contract, E2E profile list = the four A4 options | Regression cover for both defects; the `tests/e2e/*` files execute on Windows CI only |
| `docs/PRINTING.md`, `docs/DATABASE.md` | "A4-only document policy (4.3.0)" section, rewritten runtime-path/watermark/customization geometry, new "Print/PDF geometry audit" section, corrected verification limits (what a Chromium run does and does not prove); migration-008 bullet | The documentation must not claim more than was measured |

## 5. Verification log

| # | What was run | Result |
| --- | --- | --- |
| 1 | `npx tsc -p tsconfig.node.json --noEmit && npx tsc -p tsconfig.renderer.json --noEmit && npx eslint .` | clean (baseline) |
| 2 | `npm test` | 48 files / 549 tests passed (baseline) |
| 3 | `npm run build` | clean (baseline) |
| 4 | Layout harness, `v4.2.2` worktree, quick-documents | 1 violation of 18; invoice grid overflow +238px @1366×768, +85px @1920×1080 (defect reproduced) |
| 5 | Layout harness, `main` (baseline commit), all routes | 0 violations of 144 |
| 6 | `npx vitest run tests/integration/ui-layout-regressions.test.ts tests/integration/a4-only-printing.test.ts` | 2 files / **50 tests passed** (37 layout contract + 13 A4-only policy) |
| 6c | `npx vitest run tests/unit/print.test.ts tests/integration/a4-only-printing.test.ts` after the boundary fix | 22 tests pass, including `asA4PageSize()` (A4 boxes keep orientation, A5/thermal/junk/missing → A4 portrait) and the source gate that fails if `executePrint`/`saveAsPdf` stop resolving through it — verified by temporarily reverting `print.ts` to raw millimetres (gate went red, then green again) |
| 6b | `node scripts/build-v422-fixture.mjs` → `npx vitest run tests/integration/migration-v422.test.ts` | fixture built from tag `v4.2.2` (`user_version` 7 confirmed) with the historic A4/A5/thermal/custom profiles; **6 tests pass**: 2 A4 profiles kept, 3 non-A4 mediums removed, receipt + report re-seeded, audit entry `2 A4 print profile(s) kept, 2 re-seeded, 3 non-A4 profile(s) removed.`, patients/appointments/visits/prescriptions/invoices/payments untouched, idempotent on reopen, `full_integrity_check` ok |
| 7 | Layout harness, `--only quick-documents`, 4.3.0 bundle | **0** invoice violations in 8 measured panels; every size reports the required two-row arrangement `[Item or procedure* · Qty · Unit price (৳)] [Discount (৳) · Line total (৳)]` with 0 grid scroll (was +238px overflow at 1366×768 and +85px at 1920×1080 on `v4.2.2`) |
| 8 | Layout harness, all screens, 4.3.0 bundle (`/tmp/main-a4.json`) | **0 violations of 192** screen/viewport pairs (24 screens × 8 viewport sizes incl. 2560×1440 and 1180×720), 0 walk-in-invoice violations |
| 9 | `npm test` | **50 files / 572 tests passed** (baseline: 48 / 549; the extra file is `tests/integration/migration-v422.test.ts`, 6 tests, plus the boundary-enforcement helper/gate tests) |
| 10 | `npm run typecheck` (both `tsc -p` projects) and `npx eslint .` | clean |
| 11 | `npm run build` (main `tsc` + preload bundle + vite) | clean; `dist/renderer` rebuilt from the 4.3.0 sources for every measurement above |
| 12 | Layout harness, quick-documents, renderer built from the **released `v4.2.3`** tag (`/tmp/wt-v423`, `/tmp/v423-quick.json`) | **1** walk-in-invoice violation: at 1180×720 (the minimum supported window) the line is a single row of five fields, i.e. not the required arrangement; every other measured size is two rows with 0 overflow, 0 clipped values |
| 13 | Layout harness, quick-documents, 4.3.0 bundle, same contract | **0** violations in 8 panels; two rows at every size incl. 1180×720 |
| 14a | **Windows CI**, run [38721232487](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38721232487) (branch push) and run [38721261642](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38721261642) (PR [\#42](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/42)) on `a7a6366` | Windows `verify` **SUCCESS** (dependency audit, typecheck, lint, Vitest, build) and real **Electron E2E SUCCESS** — the four-A4-profile print window, the two-row arrangement at 1180×720 / 1366×768 / 1920×1080 and the walk-in document journeys all pass in the real app window. An earlier run on `822f845` failed the E2E job on one wrong expected constant in `tests/e2e/responsive-layout.spec.ts` (expected ৳1,523,455,203.26, the app renders 1234 × 1,234,567.89 − 99.99 = ৳1,523,456,676.27); fixed in `a7a6366` |
| 14b | Windows `NSIS installer + installed-artifact smoke test` job | see the row below / §6 — the job runs only after verify + E2E pass |
| 14 | `node scripts/layout-audit.mjs --pdf /tmp/pdf-audit-430 --json /tmp/pdf-audit-430.json`, 4.3.0 bundle | **0 violations**: 13 printable documents + 3 landscape views. Every document: screen 210×297mm, PDF `/MediaBox` 209.9×297mm (595.28×841.89pt), 1 page, padding 12/12mm, no overflow; landscape: screen 297×210mm, PDF 297×209.9mm. The landscape *prescription* paginates to 2 PDF pages with content on both (expected flow once the page is shorter) — recorded, not a violation |

**Harness fixture note (why the first `--pdf` runs failed).** `context.addInitScript(fn)` serializes
only the function body, so the injected bridge could not see any constant or helper defined in the
module (`paged`, the invoice/appointment fixtures): every dependent print route showed an ErrorState
instead of `.print-doc`. The bridge now interpolates those fixtures into its own source
(`const X = ${JSON.stringify(x)}`) and the failure path prints the on-screen reason plus console/page
errors, which is what identified the cause. `invoice`/`receipt`/`appointment-card` therefore needed no
product change — only fixtures (`payments/list` with `invoiceId`, an array from `appointments/list`).

## 6. Release gates still open

- Windows `package` job on the final candidate commit: NSIS installer build, silent install, installed
  smoke test, installer SHA-256 (it runs only when `verify` and `Electron E2E` pass; it is the last
  automated gate that cannot run in this Linux sandbox).
- Manual Windows-device checks: physical printer output, on-paper watermark, installed DPI, Bengali
  glyph shaping, real Save-as-PDF dialog, an upgrade of a real clinic database (disposable copy) and
  uninstall with data retained.
- Tag + GitHub Release publication for `4.3.0`: **requires the candidate commit to be on `main`** (CI
  refuses to publish a tag that is not an ancestor of `main`), and the task brief forbids merging into
  `main` without explicit authorisation — so publication is a pending, clearly-flagged gate. PR
  [#42](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/42) is open and must
  not be merged until the user says so.

## 7. Next step

State at the end of this batch: the 4.3.0 candidate is committed except for the v4.2.2-fixture batch
described above (fixture, upgrade suite, audit-summary clarification, doc updates). Sequence:

1. Commit and push this batch; wait for the Windows `verify`, `Electron E2E` and `package` jobs on the
   new head (the previous head `a7a6366` is already green for `verify` + E2E).
2. Re-run the local gate set on the pushed head (typecheck, lint, `npm test`, `npm run build`,
   `layout-audit` screens and `--pdf`) and record the numbers here.
3. Phases C–G of the audit plan (functional/wiring, security/database/dependencies, UI/UX,
   maintainability, full regression, release verification).
4. Ask for explicit authorisation before merging PR #42 into `main`; only then tag `v4.3.0` at the
   merge commit and let the tag-gated workflow publish the installer and checksum.
