# Dentiva Pro 4.2.0 — release verification report

**Outcome: published successfully.** This report records the final merge, tagged CI result, published
GitHub release, installer metadata, and checks that remain unperformed. It is a documentation-only
follow-up after publication; it does not modify the tag or release assets.

## Release identity

| Item | Verified value |
| --- | --- |
| Version | `4.2.0` (`package.json` on the release commit) |
| Pull request | [#30](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/30), merged 2026-10-14 15:34:14 UTC |
| Merge commit | `5af241edab8a3c7c8f66006e5617d9bd8ff93757` |
| Tag | [`v4.2.0`](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v4.2.0), pointing to the merge commit above |
| Published release | 2026-10-14 15:40:58 UTC; non-draft, non-prerelease, and marked Latest |
| Tagged workflow | [GitHub Actions run 38590568540](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38590568540) |

## Checks that passed

The tag-gated workflow completed with success in all three jobs:

1. **Typecheck, lint, unit & integration tests:** dependency install, production dependency audit,
   main and renderer/test typechecks, lint, Vitest suite, production build, and release-code marker
   scan all passed.
2. **Electron E2E (Windows):** native module rebuild and Playwright against the real Windows app
   window passed.
3. **NSIS installer and installed-artifact smoke:** generated Windows icons, rebuilt native
   modules, verified the Windows Argon2 dependency before packaging and at its packaged runtime
   path, built the actual NSIS installer, silently installed it, and passed the installed-app
   activation/setup/sign-in smoke scenario on a fresh Windows profile. Checksum generation and
   tagged GitHub Release publication passed.

The prior selector failures in early PR runs were fixed by switching to accessible labels. The final
PR run [38589247140](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38589247140)
passed the applicable checks; the initial failures were not waived.

## Published assets

| Asset | Size | SHA-256 / GitHub asset digest |
| --- | ---: | --- |
| [`DentivaPro-Setup-4.2.0.exe`](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/download/v4.2.0/DentivaPro-Setup-4.2.0.exe) | 100,055,048 bytes | `6c3a100e3874a8e9c63bf1db529993aaf8cdc615cac6e2eca3fb10831d716d9b` |
| [`SHA256SUMS.txt`](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/download/v4.2.0/SHA256SUMS.txt) | 94 bytes | GitHub asset digest `c169df732e24c00690f9861c08d43ff87f5d85472427a7128f8480010532b32d` |

GitHub's release asset API reports the installer digest as
`sha256:6c3a100e3874a8e9c63bf1db529993aaf8cdc615cac6e2eca3fb10831d716d9b`, matching the hash
reported by the workflow's successful checksum step. The workflow also uploaded the 94-byte
checksum manifest. The release installer was not separately downloaded in this sandbox for a
second local checksum comparison; verification is based on the successful Windows CI checksum step
and the GitHub release asset metadata.

## Checks and scenarios not covered

- No physical printer, clinic paper/DPI, or Bengali paper-rendering check was performed.
- The Windows installation smoke test used a fresh CI profile. It did not migrate, restore, or roll
  back a real clinic database. Clinics must make and verify a separate backup before upgrading; the
  schema migration is forward-only.
- The sandbox's local Vitest run passed 46 files / 482 tests but logged an Electron binary download
  error. Therefore local Electron E2E is not claimed; the Windows CI E2E passed.
- The local full development dependency audit reports 8 moderate findings and no high/critical
  findings; `npm audit --omit=dev` reported zero production vulnerabilities.

## Release links

- [Published GitHub release](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v4.2.0)
- [Merged implementation PR #30](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/30)
- [Final progress record](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/blob/main/docs/PROGRESS_V4.2.0.md)
- [Repository audit](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/blob/main/docs/AUDIT_V4.2.0.md)
