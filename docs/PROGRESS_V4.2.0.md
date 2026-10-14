# Dentiva Pro 4.2.0 — progress and release record

**Final status: released and published on 2026-10-14.** This record reflects the observed GitHub merge,
tagged Windows CI, release publication, and asset metadata. A successful local build alone is not
counted as a Windows package or release.

## Baseline and release identity

| Item | Value |
| --- | --- |
| Product version at task start | 4.1.2; the GitHub release `v4.1.2` already existed. |
| Starting revision | `1c901a34` (`main` / `origin/main`, merge of the v4.1.2 release PR). |
| Working branch | `arena/05bfe811-dentiva-windows-application` (fixed Arena branch). |
| Released version | 4.2.0, a minor feature release. |
| PR | [#30](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/30), merged 2026-10-14 15:34:14 UTC. |
| Merge commit / tag target | `5af241edab8a3c7c8f66006e5617d9bd8ff93757`. |
| Release tag | [`v4.2.0`](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v4.2.0); tag was not recreated or moved. |
| GitHub release | Published 2026-10-14 15:40:58 UTC and verified as Latest. |
| Schema | Version 6 before this release; migration 007 adds the optional instruction column. |

## Implementation delivered

- Unified registered-patient and Walk-in prescription medicine editing.
- Added common Walk-in C/C and O/E choices while retaining a manual **Other** entry path.
- Added an optional verbatim one-line medicine instruction through validation, IPC/service, additive
  nullable migration, preview, and print. When supplied, the one-line instruction replaces the
  structured dosing lines in print rather than appearing beside potentially duplicate directions.
  Registered prescriptions persist both forms; Walk-in remains transient.
- Clarified invoice discount and received-amount labels without changing invoice calculations or
  payment behavior.
- Added a disabled-by-default, centered clinic-logo watermark with bounded size/opacity controls
  and intrinsic logo aspect ratio for supported printable document types.
- Improved form labels and refreshed local Settings state after saving or removing a logo.
- Added migration, validation, watermark, document-layout, accessibility, and data-preservation
  regressions. See [`AUDIT_V4.2.0.md`](AUDIT_V4.2.0.md) for the audit index.

## Local verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run build` | Passed. |
| `npm test` | 46 files / 482 tests passed. The suite logged an Electron binary download error (`TypeError: fetch failed`) but exited 0; this is not counted as an Electron E2E pass. |
| `npm audit --omit=dev` | 0 production vulnerabilities reported. |
| Full `npm audit` | 8 moderate development-tree findings; 0 high/critical after two lockfile-only transitive fixes. |
| `git diff --check` / release-code marker scan | Passed on the release candidate; no whitespace errors or scanned TODO/FIXME/HACK markers. |
| `npm ci` on this Linux host | Not run: the Windows-only Argon2 package causes `EBADPLATFORM` here. `npm ci` passed on the Windows CI runner. |
| Electron E2E in this sandbox | Not verified locally because Electron was unavailable and its binary download failed. Windows E2E passed in the tag workflow below. |
| Physical printer / paper / target clinic device | Not tested. |

## Pull request and release verification

The first E2E attempts exposed stale selectors after the medicine editor became shared. The template
and Walk-in E2E locators were updated to accessible field labels. The final PR run passed; the
reported selector failures were corrected, not waived.

| Gate | Observed outcome |
| --- | --- |
| PR verification | [Run 38589247140](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38589247140) passed the applicable typecheck, lint, unit/integration, build, Windows Electron E2E, NSIS packaging, native Argon2 path verification, and installed-artifact smoke-test checks. |
| Merge | PR #30 merged to `main` at `5af241edab8a3c7c8f66006e5617d9bd8ff93757`. |
| Tagged release workflow | [Run 38590568540](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38590568540) completed successfully. All three jobs passed: typecheck/lint/unit & integration/build, Windows Electron E2E, and NSIS installer plus installed-artifact smoke test. |
| Windows installer checks | NSIS build passed; CI verified the packaged Argon2 native binding at its runtime path, silently installed the actual installer, and passed the installed-app activation/setup/sign-in smoke scenario on a fresh profile. Checksum generation and tagged release publication also passed. |
| GitHub release | [`v4.2.0`](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v4.2.0) is published, non-draft, and marked Latest. |

### Published artifacts

| Asset | Size | SHA-256 |
| --- | ---: | --- |
| [`DentivaPro-Setup-4.2.0.exe`](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/download/v4.2.0/DentivaPro-Setup-4.2.0.exe) | 100,055,048 bytes | `6c3a100e3874a8e9c63bf1db529993aaf8cdc615cac6e2eca3fb10831d716d9b` |
| [`SHA256SUMS.txt`](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/download/v4.2.0/SHA256SUMS.txt) | 94 bytes | GitHub asset digest: `c169df732e24c00690f9861c08d43ff87f5d85472427a7128f8480010532b32d` |

The GitHub release API's installer asset digest matches the installer SHA-256 reported by the
successful Windows CI checksum step. The workflow's checksum and publication steps passed. The
release asset was not separately downloaded for a second local checksum comparison.

## Limitations and safe upgrade notes

- The Windows installed-artifact smoke test used a fresh CI profile; no real clinic database
  migration, restore, or rollback rehearsal was performed.
- Physical-printer output, paper/DPI behavior, Bengali paper rendering, and behavior on a clinic's
  actual Windows device remain untested.
- The full development dependency audit still reports 8 moderate findings; the production-only audit
  reports none, and no high/critical findings remain.
- Migration 007 is additive but forward-only. Before clinic installation, create and verify a
  separate backup; do not treat an older application version as a database rollback. Confirm
  printed output on the target printer before relying on a customized watermark or layout.

[`RELEASE_REPORT_V4.2.0.md`](RELEASE_REPORT_V4.2.0.md) provides the concise release evidence and
verification limits. This final progress entry is a post-publication documentation follow-up on
`main`; it does not alter the `v4.2.0` tag, installer, or release assets.
