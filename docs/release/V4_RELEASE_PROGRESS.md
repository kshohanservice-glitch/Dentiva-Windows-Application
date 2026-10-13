# Dentiva Pro — v4.0.0 release progress log

Durable checkpoint file. Update at every meaningful checkpoint.
The mission is complete only when the `v4.0.0` GitHub Release and its
downloadable Windows installer have been verified.

## Branch and base

| Item | Value |
| --- | --- |
| Working (release) branch | `arena/8554befc-dentiva-windows-application` |
| Base commit (production `main`) | `61798510846884367e238114fe6d532c4fa7c527` |
| Previous production release | `v3.1.0` (tag `d8d68dfccd15447bba79af118ac33882655dcb8e`) — must stay untouched |
| Target version | `4.0.0` |
| Target tag | `v4.0.0` (must not exist yet; `git ls-remote --tags origin` confirms it does not) |

The session branch `arena/8554befc-dentiva-windows-application` is branched
directly from the verified production `main` commit above, so it serves as the
dedicated release branch required by the release procedure. No work is done on
`main`; `main` is only fast-forwarded by the release pull request at the end.

## Environment notes (verified 2026-10-13)

* Sandbox: Linux x64, Node 22.22.3, npm 10.9.8. Outbound network is restricted
  to `github.com`, `codeload.github.com`, `api.github.com`,
  `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`.
* `npm ci` fails on Linux because `@node-rs/argon2-win32-x64-msvc` is a
  win32-only *dependency*. Workaround used for local validation only:
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --force --ignore-scripts`.
  `better-sqlite3` and `@node-rs/argon2` both load their npm-shipped N-API
  prebuilds, so the full Vitest suite runs natively.
* **No Electron binary and no browser can be downloaded** (Electron release
  assets are served from `objects.githubusercontent.com`, which is blocked).
  Therefore no pixel-level screenshot verification and no local Electron E2E is
  possible in this sandbox. This is recorded as a platform verification gap;
  Windows CI is the automated gate for installer + E2E.
* `package-lock.json` is never edited.

## Baseline (before any change) — actual results

| Check | Result |
| --- | --- |
| `npx vitest run` | **29 files / 253 tests passed** (10.7 s) |
| `npm run typecheck` | pass |
| `npx eslint .` | pass, 1 pre-existing warning (`src/main/core/passwords.ts` unused eslint-disable directive) |
| `npm run build` | pass |

## Defects identified (audit)

| # | Severity | Area | Defect | Status |
| --- | --- | --- | --- | --- |
| A | High | Print/PDF | Print preview rendered `****` for every amount; the only real value lived in a `@media print`-only span, so the preview (a document) was not WYSIWYG | **FIXED** |
| A2 | Medium | Print/PDF | `PrintPage` used a private float-based `fmtBdt` instead of the shared integer `formatBdt`; renderer `bdt()` also used float math | **FIXED** |
| B | High | Global Search | `.search-hit .kind` inherited a stale `width: 64px` from an earlier duplicate rule block, so `APPOINTMENT`/`PRESCRIPTION` overflowed the label box and intruded into the title; two conflicting rule blocks also misaligned rows | **FIXED** |
| B2 | Medium | Global Search | `.shell { text-transform: capitalize }` was not excluded for `.search-hit`, so patient names, codes and invoice numbers were displayed title-cased | **FIXED** |
| C | High | Branding | Login and dashboard header showed the product name and a `D` placeholder instead of the configured clinic name/logo; no shared branding component, no fallback for a broken logo image | **FIXED** |
| C2 | High | Backup | `.dpv` backups contained only `attachments/`; the `branding/` directory (clinic logo) was not archived, so restoring a backup silently lost the clinic logo | **FIXED** |
| D | Low | Settings | `uploadLogo` accepted any bytes with an image extension; a corrupt/mislabelled file produced a broken image everywhere | **FIXED** |
| E | Low | Lint | Pre-existing "unused eslint-disable directive" warning in `src/main/core/passwords.ts` | **FIXED** |

## Modified files

Task A (print / export amounts)

- `src/renderer/components/print-money.tsx` (new) — authoritative `PrintMoney`
- `src/renderer/components/formatted-money.tsx` — printable mode renders the real amount
- `src/renderer/styles/print.css` — single `.print-money`, screen/paper pair removed
- `src/renderer/pages/PrintPage.tsx` — `PrintMoney` + shared `formatBdt`; reveal toggle removed from the export toolbar
- `src/renderer/format.ts` — `bdt()` delegates to the shared integer formatter
- `tests/unit/print-money.test.ts` (new, 13 tests)
- `tests/e2e/app.spec.ts` — print-window money assertion updated to the new contract

Task B (global search layout)

- `src/renderer/components/search-hit-row.tsx` (new) — `SearchHitRow` + category labels
- `src/renderer/components/shell.tsx` — uses `SearchHitRow`
- `src/renderer/styles/global.css` — one canonical grid-based `.search-hit` block, duplicate block removed, `text-transform` exclusion, modal width guard
- `tests/unit/search-hit-row.test.ts` (new, 14 tests)
- `tests/e2e/app.spec.ts` — new global-search layout regression test

Task C (clinic branding)

- `src/shared/branding.ts` (new) — product vs clinic identity helpers
- `src/renderer/components/clinic-brand.tsx` (new) — `ClinicLogo` (with broken-image fallback) + `ClinicName`
- `src/renderer/pages/Login.tsx` — clinic identity, product subtitle
- `src/renderer/components/shell.tsx` — header brand + lock overlay
- `src/renderer/styles/global.css` — logo/name styling, ellipsis, `text-transform` exclusion
- `src/main/services/settings.ts` — image signature validation, defensive logo size ceiling
- `src/main/services/archive-safety.ts` — `branding/` archive entries with traversal + size limits
- `src/main/services/backup.ts` — archive/restore/rollback for the branding folder
- `tests/unit/branding.test.ts` (new, 15 tests)
- `tests/integration/branding.test.ts` (new, 8 tests)
- `tests/unit/archive-safety.test.ts` — 5 new branding archive cases

Housekeeping

- `src/main/core/passwords.ts` — removed a redundant eslint-disable directive

## Tests run

| Command | Result |
| --- | --- |
| `npx vitest run` (baseline, before changes) | 29 files / **253 passed** |
| `npx vitest run` (after Tasks A–C + fixes) | 33 files / **308 passed** |
| `npm run typecheck` | pass |
| `npx eslint .` | pass (0 errors, 0 warnings after removing the pre-existing warning) |
| `npm audit --omit=dev --audit-level=moderate` | 0 vulnerabilities |
| `npm run build` | pass |
| TODO/FIXME/HACK grep gate (`src tests scripts`) | none |

## Build / package status

| Item | Status |
| --- | --- |
| Local `npm run build` (main + renderer) | pass |
| Local Windows NSIS installer build | **not possible** — no Electron binary can be downloaded in this sandbox |
| Windows CI (run 38469282380, commit `cd375b0`) — verify: typecheck, lint, vitest, build, marker gate | **PASS** |
| Windows CI (same run) — real Electron Playwright E2E | **PASS** |
| Windows CI (same run) — NSIS installer build + silent install + installed-app smoke test + SHA-256 | **PASS** |

The Windows CI runner therefore verified the real installer and the real
application window. What it still cannot verify is physical printer/PDF output,
DPI scaling and assistive-technology behaviour; those remain documented gaps.

## Last successful checkpoint

Release branch `arena/8554befc-dentiva-windows-application` at commit `cd375b0`,
pushed to origin; PR #25 open against `main`. All local gates green (308 tests,
typecheck, lint, audit, build). Windows CI run **38469282380** (pull_request) and
**38469274913** (push) both **succeeded** — verify, E2E and the NSIS
installer + installed-artifact smoke test.

Two CI iterations were needed and both failures were fixed, not worked around:
1. `tests/integration/branding.test.ts` assumed a POSIX separator in the stored
   relative logo path; now compares the logical forward-slash form.
2. The E2E search test read `innerText()`, which returns the CSS-uppercased
   badge rendering; now reads the DOM value and additionally asserts the badge is
   never ellipsised.

## Current blocker / recovery steps

None. Recovery: `git status` on `arena/8554befc-dentiva-windows-application`, then
`npx vitest run` (all green) and `npm run build`.

## Release tag and publication status

`v4.0.0` tag does not exist on the remote (`git ls-remote --tags origin`).
Publication path, in order:

1. Merge PR #25 into `main` (fast-forward; `main` is otherwise untouched and all
   prior tags/releases are preserved).
2. Wait for the `main` CI run to pass verify + E2E.
3. Create and push the annotated tag `v4.0.0` pointing at the merged commit.
4. CI's `package` job builds the NSIS installer, smoke-tests the installed app,
   computes `SHA256SUMS.txt` and publishes the release with
   `docs/RELEASE_NOTES_4.0.0.md`. It refuses to publish if the tag does not match
   `package.json`, if the tag commit is not `GITHUB_SHA`, if it is not an ancestor
   of `origin/main`, if the notes file or the version-matched installer is
   missing, if the checksum does not match, or if the release already exists.
5. Independently download the published installer and checksum and verify the
   SHA-256 of the downloaded file.

Never create a tag or release as a workaround for a red or unexecuted gate.
