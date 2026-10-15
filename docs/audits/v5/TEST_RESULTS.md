# Dentiva Pro v5 — test and build results

Every result below was executed. Nothing marked as passing was inferred. Commit-specific results apply only to
the commit named.

**Release-candidate commit:** `56ea4cb` (`chore(release): 5.0.0 release candidate`), branch
`arena/8ba688c2-dentiva-windows-application`.

## 1. Environments

| Environment | Used for | Limits |
| --- | --- | --- |
| Linux sandbox: Node v22.22.3, npm 10.9.8 | typecheck, lint, vitest, build, `npm audit`, layout, PDF and axe harness | Not Windows. The Electron binary and the Playwright browser downloads are blocked, so **no local Electron E2E**. No printer or display server |
| Chromium 153 (`@sparticuz/chromium`) + `playwright-core` 1.63 | Harness: renderer bundle with a stubbed bridge | Chromium, not Electron's print path |
| GitHub Actions `CI` on `windows-latest` | verify, real-window Electron E2E (Playwright), NSIS installer build, silent install and installed-artifact smoke test | Job logs and artifacts are stored on `blob.core.windows.net`, which this sandbox cannot reach. Results come from the job and step conclusions and annotations in the GitHub API |

Install note: `npm_config_nodedir=/usr/local npm ci --force` (the Windows-only Argon2 binary needs `--force` on
Linux; documented in TESTING.md).

## 2. Local gates

### 2a. Release-candidate head `b40da3a` (V5-033)

Run on a working tree whose code was byte-identical to `b40da3a` (the committed files), Node v22.22.3.

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | ✔ exit 0 |
| Lint | `npx eslint .` | ✔ exit 0, no output |
| Unit + integration | `npx vitest run` | ✔ **57 files, 660 tests passed**, 0 failed, 0 skipped |
| Build | `npm run build` | ✔ exit 0, with the expected chunk-size warning (§5); main chunk 589.13 kB (162.31 kB gzip) |
| Production advisories | `npm audit --omit=dev --audit-level=moderate` | ✔ 0 vulnerabilities |
| Marker gate | `grep -rEn 'TODO\|FIXME\|HACK' src tests scripts` | ✔ none |

Also checked for this change:
- The new tests pass with Node's default locale set to en-GB (`LC_ALL=en_GB.UTF-8`).
- They also pass in a copy of the tree converted to CRLF line endings, as on a Windows checkout. The same copy
  reproduces the CI failure of the `c557530` test.
- Without the en-US pin in `document-layout`, the frozen appointment-card comparison fails under en-GB and passes
  under en-US, so the pin is needed.
- Mutation check on the `b40da3a` tests: removing the read-back fails 2 tests; putting the machine-locale calls
  back fails 2 (appointment card) or 1 (dashboard).

### 2b. Original release candidate `56ea4cb` (clean tree)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | ✔ exit 0 |
| Lint | `npx eslint .` | ✔ exit 0, no output (0 errors, 0 warnings) |
| Unit + integration | `npx vitest run` | ✔ **56 files, 646 tests passed**, 0 failed, 0 skipped (25.9 s) |
| Build | `npm run build` | ✔ exit 0, with one expected warning (§5) |
| Production advisories | `npm audit --omit=dev --audit-level=moderate` | ✔ 0 vulnerabilities |
| Full-tree advisories | `npm audit` | 8 moderate, all `sprintf-js` via electron-builder (dev and build only). Accepted, V5-042 |
| Marker gate | `grep -rEn 'TODO\|FIXME\|HACK' src tests scripts` | ✔ none |

**Test-count history:**

| Point | Files | Tests |
| --- | --- | --- |
| Baseline `303712e` (v4.2.3) | 48 | 549 |
| After merging PR #42 (`dd81c08`) | 50 | 572 |
| After Phase 2 security (`8e0a336`, `1467d56`) | 53 | 611 |
| After `f141c0e` / `f148208` | 53 | 612 |
| After print fixes (`c7869bf`) | 54 | 619 |
| After fonts and headings (`22e6802`) | 54 | 621 |
| After accessibility (`5eda3af`) | 55 | 639 |
| After the audit filter and IPC surface (`dc1534b`) and RC (`56ea4cb`) | 56 | 646 |
| First V5-033 attempt (`c557530`, superseded) | 57 | 657 |
| V5-033 fix (`b40da3a`) | 57 | 660 |

Two tests changed on purpose:
- The ISS-010 case in `audit-regressions` now expects that an Owner **cannot** demote themselves (decision D-8).
- `document-layout` renders the frozen legacy appointment card with an en-US time format, so the comparison no
  longer depends on the test machine's locale (V5-033).

No test from the baseline or the RC was deleted or skipped. The `c557530` tests for the `--lang` switch were
replaced in `b40da3a`, together with the switch.

## 3. Windows CI (GitHub Actions `CI` workflow)

| Run | Commit | verify | Electron E2E | NSIS + installed smoke | Notes |
| --- | --- | --- | --- | --- | --- |
| 38741516954 | `1467d56` | ✔ | ✔ | ✔ | after Phase 2 security and V5-012 |
| 38744605558 | `f148208` | ✔ | ✘ | skipped | E2E strict-mode violation: `getByText('Paid')` matched the status badge and the "Paid" label. Fixed in `1cf5a6e` (test locator, not app code) |
| 38746706356 | `c7869bf` | ✔ | ✔ | ✔ | includes the E2E fix and the print fixes |
| 38748781825 | `5eda3af` | ✔ | ✔ | ✔ | fonts, headings, accessibility |
| 38750058064 | `dc1534b` | ✔ | ✔ | ✔ | audit-log filter, IPC surface test. Artifact `DentivaPro-Windows-NSIS` (99,409,033 B, zip digest `sha256:5cceca4b51e54e6894d02e51e23edfcba8a0867097a34cd01cc61223fdac59b9`) |
| 38751182873 | `56ea4cb` (RC) | ✔ | ✔ | ✔ | **release candidate.** Artifact `DentivaPro-Windows-NSIS` (99,409,026 B, zip digest `sha256:9282efa1d636a38567588fcdee046a07b69deac2cfa3e249bf3145edb9e36c48`, expires 2026-11-14). Publish step skipped (branch) |
| 38752546753 | PR #43 merge ref (`338a6b8` into `main` `303712e`) | ✔ | ✔ | ✔ | `pull_request` event on draft PR #43. Same code as the RC; the merge with `main` is clean |
| 38753767760 | PR #43 merge ref (`093af95`) | ✔ | ✔ | ✔ | Started by a docs-only push. For `pull_request` events `paths-ignore` is checked against the whole PR diff, so every push to the PR branch runs CI; only `push`-event runs skip docs-only commits |
| 38757316130 | `c557530` | ✘ | ✘ | skipped | **First V5-033 attempt, disproved.** E2E: `date field order: Month,Day,Year`, so `--lang=en-GB` did not change the native date field in Electron on Windows. verify: a new unit test searched for `…;\n`, which never matches a CRLF checkout (test bug). Both read from the check-run annotations |
| 38757325484 | PR #43 merge ref (`c557530`) | ✘ | ✘ | skipped | Same two failures |
| 38759566953 | `b40da3a` | ✔ | ✔ | ✔ | **Current release-candidate head.** V5-033 read-back, including the new E2E test. Artifact `DentivaPro-Windows-NSIS` (99,409,337 B, zip digest `sha256:e20a71b70848ea4e06cdf974aecb155dec09757dbcb53f129802b3e0e2334022`, expires 2026-11-14). Every NSIS step succeeded, including the silent install and smoke test; publish skipped (branch) |
| 38759574773 | PR #43 merge ref (`b40da3a`) | ✔ | ✔ | ✔ | `pull_request` event; same code |

Steps in a green run (38750058064), from the jobs API:
- **verify:** production audit, typecheck for main and for renderer plus tests, lint, vitest, build, marker gate.
- **E2E:** native rebuild for the Electron ABI, then "Playwright E2E (real app window)".
- **NSIS:** icons, native rebuild, Argon2 dependency check, NSIS build, packaged Argon2 binding check, silent
  install and smoke test, checksums, artifact upload, payload size report.
- "Publish new tagged GitHub Release" was **skipped**: branch pushes never publish.

The E2E test count per run cannot be read here, because job logs are on blocked storage. The suite contents are
in `tests/e2e/`.

### 3a. Release-candidate run (38751182873, `56ea4cb`, 2026-10-15 14:25–14:32 UTC)

All three jobs succeeded. Every step succeeded except "Upload Playwright report" (skipped: only uploaded on
failure) and "Publish new tagged GitHub Release" (skipped: not a tag).
- **verify:** production audit, typecheck for main and for renderer plus tests, lint, vitest, build, marker
  gate.
- **E2E:** native rebuild, then Playwright E2E in the real app window.
- **NSIS:** icons, native rebuild, Argon2 checks, NSIS build, packaged binding check, silent install and smoke
  test, checksums, artifact upload.

The zip digest identifies the CI artifact. It is **not** the installer's own SHA-256, which is inside the
artifact (`SHA256SUMS.txt`) and could not be downloaded from this environment. A release needs the tag run's
checksum and an independent re-download check (Gate F).

## 4. Harness results (Chromium 153, renderer bundle of `b40da3a`)

| Check | Result |
| --- | --- |
| Layout: 25 screens and modal scenarios × 8 viewports (2560 → 480 px), light. The 25th is the New appointment modal (V5-033) | ✔ 0 / 200 violations |
| Layout, dark theme | ✔ 0 / 200 violations |
| Walk-in invoice panels | ✔ 0 violations in 8 measured panels |
| A4 PDF audit: 13 documents + 3 landscape views | ✔ 0 violations; every page 210 × 297 mm or 297 × 210 mm (±2 pt) |
| A4 PDF audit, `--long` | ✔ 0 violations. All 70 invoice lines, 150 report rows and 28 medicines each present once. Margins on every sheet. No stranded headings |
| Glyphs | ✔ ৳ embedded from NotoSansBengali, 0 U+FFFD in 16 PDFs |
| Appointment card time (V5-033) | ✔ PDF text reads "10:00 AM" (appointment card) and "05:30 PM" (walk-in card) |
| Date read-back (V5-033) | ✔ screenshot: native field "10/15/2026" (en-US harness browser), read-back "Thu 15 Oct 2026" |
| Accessibility: axe-core 4.14.0, WCAG 2.0/2.1 A + AA, 25 screens and modals, 1366 × 768 | ✔ light 0, dark 0 violating nodes (before the fixes: 8 and 29) |
| Boot cost proxy (V5-031) | Script 41 ms, tasks 104 ms, FCP 116 ms (median of 7, 2 vCPU) |

## 5. Warnings (not suppressed)

| Warning (exact text) | Source | Cause | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| `(!) Some chunks are larger than 500 kB after minification. Consider: …` | `vite build` (renderer) | One 588 kB chunk (161 kB gzip) | None functional: loaded from local disk, about 41 ms script cost measured | Accepted, V5-031. The pre-existing `chunkSizeWarningLimit: 900` override (since `9b937aa`) was removed in `56ea4cb` so the warning is visible |
| `Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4.` | GitHub Actions annotation, every run | Pinned action majors target Node 20 | None today; runs succeed on Node 24 | Bump the action majors in a CI-maintenance change, then verify with a CI run |
| `TypeError: fetch failed` (stderr during vitest, once) | `tests/integration/whatsapp-open-ipc.test.ts` imports `electron`; `@electron/get` tries to download the binary | No network access to the Electron CDN in the sandbox | None: the test passes and the suite exits 0. Does not occur on Windows CI | Documented. Not a test failure |
| `npm ci` platform warnings for the Windows Argon2 binary | Linux install | Windows-only optional native package | Linux only | `--force` install, documented in TESTING.md |

## 6. Not run or not verifiable here

- Local Electron E2E: the Electron binary download is blocked. Windows CI runs it.
- Physical printing and Electron `printToPDF` geometry.
- A screen reader (NVDA or Narrator), and a manual keyboard walk-through on Windows.
- Upgrades on real clinic databases. Representative fixtures were used instead: the v3.0.3 and v4.2.2 fixture
  databases and the migration 008 profile fixtures.
- Installer SHA-256 re-download check: artifacts are on blocked storage, and no release is authorized.
