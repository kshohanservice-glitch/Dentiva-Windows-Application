# Dentiva Pro 4.2.0 — progress and release record

This file records observed outcomes only. A started check is not a passed check, and a local build is
not a Windows installer or release.

## Baseline and branch

| Item | Value |
| --- | --- |
| Product version at task start | 4.1.2; the GitHub release `v4.1.2` already existed. |
| Starting revision | `1c901a34` (`main` / `origin/main`, merge of the v4.1.2 release PR). |
| Working branch | `arena/05bfe811-dentiva-windows-application`; keep all development commits on this fixed Arena branch. |
| Target version | 4.2.0 (minor feature release; unique tag/release must be confirmed before publication). |
| Schema at start | Version 6. |

## Implementation delivered in this branch

- Unified registered-patient and Walk-in prescription medicine editing.
- Added common Walk-in C/C and O/E choices while retaining a manual **Other** entry path.
- Added an optional verbatim one-line medicine instruction through validation, IPC/service, an
  additive nullable migration, preview and print. The one-line direction replaces structured
  dosing lines in the printed output when present, avoiding duplicates; registered prescription data
  persists both forms, while Walk-in remains transient.
- Clarified invoice discount and received-amount labels without changing invoice calculations or
  payment behavior.
- Added a disabled-by-default, centered clinic-logo watermark with bounded size/opacity controls
  and intrinsic logo aspect ratio for supported printable document types.
- Improved form labels and refreshed local Settings state after saving/removing a logo.
- Added migration, validation, watermark, document-layout, accessibility, and data-preservation
  regressions. See `docs/AUDIT_V4.2.0.md` for the audit index and limitations.

## Local verification (observed)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run build` | Passed. |
| `npm test` | 46 files / 482 tests passed. The suite logged a failed Electron binary download (`TypeError: fetch failed`) but exited 0. |
| `npm audit --omit=dev` | 0 production vulnerabilities reported. |
| Full `npm audit` | 8 moderate dev-tree vulnerabilities, 0 high/critical after two lockfile-only transitive fixes; see audit notes. |
| `git diff --check` / release-code marker scan | Passed; no whitespace errors and no TODO/FIXME/HACK markers in the CI-scanned source/test files. |
| `npm ci` on this Linux host | Not run in this validation pass; the known Windows-only Argon2 package causes `EBADPLATFORM` on Linux. Windows CI installs on `windows-latest`. |
| Electron E2E in this sandbox | Not verified: Electron binary unavailable and download failed. |
| Windows packaging / installed `.exe` smoke test | Not run locally: this is Linux x86_64 without Wine or NSIS/makensis. Must pass Windows CI. |
| Physical printer, paper/DPI, Bengali paper rendering | Not tested; requires target Windows device and printer. |

The repository's release workflow separately runs Windows verification, real-app Electron E2E,
NSIS packaging, and silent installation plus smoke testing. A PR/CI result is not recorded as passed
until observed from GitHub Actions.

## Release checklist and current outcome

| Gate | State at implementation handoff |
| --- | --- |
| `package.json` and lockfile version | 4.2.0. |
| User-facing versioned notes | `docs/RELEASE_NOTES_4.2.0.md` added. |
| Repository audit | `docs/AUDIT_V4.2.0.md` added. |
| Local checks | Typecheck, lint, build and Vitest passed; see limitations above. |
| PR and Windows CI | [PR #30](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/30) is open. First push/PR runs (`38587907386`, `38588037335`) passed Windows verification, including `npm ci`, but E2E exposed stale selectors: the template-name placeholder was replaced by an explicit label, then the Walk-in test's `.line-editor` selector no longer matched the shared medicine editor. Updated both tests to use accessible field labels; the latest Windows rerun is pending. Installer job was correctly skipped on both earlier runs because E2E failed. |
| Merge to `main` | Pending CI and merge. |
| Tag `v4.2.0` / GitHub Release | Not created. |
| Installer asset and SHA-256 | Not produced or verified in this sandbox. |
| Final release report | To be written only after the actual release outcome is known. |

Before installing on clinic equipment, create and verify a separate backup. Do not test migration or
restore against a clinic's only copy. Confirm printed output on the target printer before relying on
a customized watermark or document layout.
