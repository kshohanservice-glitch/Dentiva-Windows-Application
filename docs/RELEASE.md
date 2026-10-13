# Dentiva Pro — release procedure (current branch)

This document describes `.github/workflows/ci.yml` as implemented, not a promise that the current checkout has passed its release gates. For actual status and blockers see `RELEASE_EXECUTION_JOURNAL.md`. The published `v3.0.3` tag and its assets must never be overwritten.

## Before tagging

1. Finish the acceptance checklist, including secure backup/restore, money privacy, clinical templates, usability guards and documentation. Run `npm ci`, `npm audit --omit=dev --audit-level=moderate`, typecheck, lint, Vitest, build and real Electron E2E. Verify migrations from a v3.0.3 database and backup/restore on disposable data. Do not label blocked checks as passed.
2. Run CI on the branch. The Windows workflow has separate verify and Electron E2E jobs. Only after both pass does it build an NSIS installer, verify native Argon2 packaging, silently install and smoke-test the actual `.exe`, calculate SHA-256, and upload the installer and checksum as a 30-day Actions artifact. A branch run **never publishes** a GitHub Release.
3. Validate on a real Windows device where possible: installation, activation and secure storage, login, migration from a preserved clinic backup, printer/PDF, screen sizes and DPI, backup/restore, uninstall with data retained. Document anything not executed.
4. Bump `package.json` and its lockfile to a **new unique version**. Confirm the intended tag does not already exist. Review release notes, user documentation, installer size/name and the tag's target commit before tagging.

## Publication gate

Push a new `v<package-version>` tag **only after** the checks pass. CI checks that the tag matches `package.json`, refers to the verified commit, and that `dist/DentivaPro-Setup-<version>.exe` exists. It recomputes SHA-256 and compares it with `dist/SHA256SUMS.txt`; it refuses to replace an existing release. After publishing, independently download both release assets and verify the checksum against the downloaded installer. Provide the tag, release and CI run links in the final report. Never create a tag or release as a workaround for a red or unexecuted gate.

## Installer and data

`electron-builder.yml` targets x64 NSIS, per-user installation, configurable install directory, desktop and Start Menu shortcuts. `deleteAppDataOnUninstall: false` preserves clinic data by default. Data migration is forward-only. Before installing over a real clinic, make and check a separate backup; never test migrations or restore against the user's only copy.

## Current environment

The Arena Linux sandbox can typecheck, lint, build and run the Vitest suite; Electron E2E here requires an Electron binary and a graphical display. Windows CI is the applicable automated installer gate. Physical printers, DPI and clinic-device behavior still require device-level verification. Consult the execution journal for exact run outcomes, not assumptions.
