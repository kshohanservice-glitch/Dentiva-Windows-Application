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
| `package.json` version at baseline | `4.2.2` (so `main` is *ahead* of the published release: it contains unreleased 4.2.3 layout work) |
| Target version for this effort | `4.3.0` (minor: A4-only printing policy + layout overhaul + audit fixes; `4.2.2` is the published baseline, `4.2.3` was never released) |
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
| `src/main/services/settings.ts`, `src/main/print.ts`, `src/renderer/pages/PrintPage.tsx`, `src/renderer/pages/Settings.tsx` | Profile read/write goes through the shared model; `profilePageCss`, the renderer's local paper tables and the receipt fallback were deleted; Settings shows the static A4 label | One source of truth for the `@page` rule; a stored legacy profile can no longer reach it |
| `src/main/db/migrations/008_a4_only_printing.ts` (new), `src/main/db/migrations/index.ts` | Migration 8 `a4-only-printing`: A4 profiles kept verbatim (printer/orientation/margins/scale/copies), page-size keys stripped, document types left without a profile re-seeded, one append-only `system.migrate` audit row, idempotent, no patient/clinical/financial writes | Published 4.2.2 databases must upgrade without silently losing printer or margin choices |
| `scripts/layout-audit.mjs` | Screens mode marks the four resizeable sizes (`supported`) and measures 24 screens × 8 viewports; `--explain`; new `--pdf [dir]` mode: all 13 printable documents rendered in the real print window plus a 3-view landscape pass, `.print-doc` measured in mm, PDFs written with `preferCSSPageSize`, `/MediaBox` parsed, per-route on-screen/console reason captured when a document fails to render | The A4 policy and the layout fix need geometry evidence, not only unit tests |
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
| 7 | Layout harness, `--only quick-documents`, 4.3.0 bundle | **0** invoice violations in 8 measured panels; every size reports the required two-row arrangement `[Item or procedure* · Qty · Unit price (৳)] [Discount (৳) · Line total (৳)]` with 0 grid scroll (was +238px overflow at 1366×768 and +85px at 1920×1080 on `v4.2.2`) |
| 8 | Layout harness, all screens, 4.3.0 bundle (`/tmp/main-a4.json`) | **0 violations of 192** screen/viewport pairs (24 screens × 8 viewport sizes incl. 2560×1440 and 1180×720), 0 walk-in-invoice violations |
| 9 | `npm test` | **49 files / 564 tests passed** (baseline: 48 / 549) |
| 10 | `npm run typecheck` (both `tsc -p` projects) and `npx eslint .` | clean |
| 11 | `npm run build` (main `tsc` + preload bundle + vite) | clean; `dist/renderer` rebuilt from the 4.3.0 sources for every measurement above |
| 12 | `node scripts/layout-audit.mjs --pdf /tmp/pdf-audit --json /tmp/pdf-audit.json`, 4.3.0 bundle | **0 violations**: 13 printable documents + 3 landscape views. Every document: screen 210×297mm, PDF `/MediaBox` 209.9×297mm (595.28×841.89pt), 1 page, padding 12/12mm, no overflow; landscape: screen 297×210mm, PDF 297×209.9mm. The landscape *prescription* paginates to 2 PDF pages with content on both (expected flow once the page is shorter) — recorded, not a violation |

**Harness fixture note (why the first `--pdf` runs failed).** `context.addInitScript(fn)` serializes
only the function body, so the injected bridge could not see any constant or helper defined in the
module (`paged`, the invoice/appointment fixtures): every dependent print route showed an ErrorState
instead of `.print-doc`. The bridge now interpolates those fixtures into its own source
(`const X = ${JSON.stringify(x)}`) and the failure path prints the on-screen reason plus console/page
errors, which is what identified the cause. `invoice`/`receipt`/`appointment-card` therefore needed no
product change — only fixtures (`payments/list` with `invoiceId`, an array from `appointments/list`).

## 6. Release gates still open

- Full local gate on the final candidate commit (typecheck, lint, vitest, build, harness).
- Windows CI on the branch: verify job, Electron E2E job, NSIS installer + silent install + installed
  smoke test, installer SHA-256.
- Installed-application smoke test on Windows (CI job `package`).
- Tag + GitHub Release publication: **requires the candidate commit to be on `main`** (CI refuses to
  publish a tag that is not an ancestor of `main`), and the task brief forbids merging into `main`
  without explicit authorisation — so publication is a pending, clearly-flagged gate.

## 7. Next step

**Committed? No.** Everything in §4/§5 is still uncommitted on the working branch. Order of work from
here:

1. Write `docs/RELEASE_NOTES_4.3.0.md` and bump `package.json` to `4.3.0`.
2. Re-run the full gate set on the final commit (typecheck, lint, `npm test`, `npm run build`,
   layout harness screens + `--pdf`), then commit and push the branch.
3. Push and let Windows CI run (verify job, Electron E2E, NSIS package + installed smoke) — the only
   place the Electron print path, the installer and the Windows E2E suites can execute.
4. Phases C–G of the audit plan (functional/wiring, security/database/dependencies, UI/UX,
   maintainability, full regression, release verification).
5. Release (tag + GitHub Release) remains a **pending, explicitly-blocked gate**: CI only publishes a
   tag that is an ancestor of `main`, and merging into `main` requires explicit user authorisation.
