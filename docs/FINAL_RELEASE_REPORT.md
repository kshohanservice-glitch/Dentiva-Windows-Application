# Dentiva Pro — Final Release Report

> **Status: DRAFT — pending CI artifact validation.**
> This report is only signed off after the built `dist/*.exe` installer has been
> silent-installed and smoke-tested on a Windows machine (GitHub Actions
> `windows-latest`), with hashes recorded below. Nothing here is claimed as
> "passed" without evidence.

- **Product:** Dentiva Pro 1.0.0 — offline Windows dental clinic management (Bangladesh)
- **Developer:** Shohan Khan — helloiamshohan@gmail.com
- **Branch:** `arena/01a0e467-dentiva-windows-application`
- **Report date:** 2026-09-27

## 1. Local quality gates (evidence: commit `6846a03`, sandbox runs)

| # | Gate | Evidence | Result |
|---|------|----------|--------|
| 1 | Main-process typecheck | `tsc -p tsconfig.node.json --noEmit` | ✅ exit 0 |
| 2 | Renderer + tests typecheck | `tsc -p tsconfig.renderer.json --noEmit` | ✅ exit 0 |
| 3 | Lint | `eslint .` | ✅ 0 errors (7 accepted `exhaustive-deps` warnings) |
| 4 | Unit + integration tests | `vitest run` | ✅ **60/60 passed**, 9 files |
| 5 | Production build | `npm run build` | ✅ renderer ~426 kB gzip 116 kB |
| 6 | Icon pipeline | `npm run icons` | ✅ multi-res `.ico` 16–256 |
| 7 | Activation-code secrecy | vitest repo-wide literal scan (src/tests/docs/e2e/scripts/.github/assets) | ✅ no plaintext code anywhere |
| 8 | Marker gate (TODO/FIXME/HACK) | grep over src/tests/scripts | ✅ 0 matches |
| 9 | Immutable financial history | DB triggers: payments & invoice_items append-only | ✅ covered by integration tests |

**Defects found & fixed by the suite (root causes, not test weakening):**
- `accounting.ts` bound `amount` into `category_id` (FK crash on every entry)
- restore flow audited through the closed pre-swap DB handle
- pre-restore backup row vanished after a successful swap
- `paths.ts` required `electron` at import time (broke headless tests)
- ambient const-enum access broke `isolatedModules` builds

## 2. CI gates (GitHub Actions — PENDING push; tokens expired 2026-09-27)

| # | Gate | Job | Result |
|---|------|-----|--------|
| 10 | Electron E2E (activation→setup→login→patient→invoice→payment→about→backup) | `e2e` @ windows-latest | ⏳ pending |
| 11 | NSIS installer build | `package` @ windows-latest | ⏳ pending |
| 12 | Silent install + packaged-app smoke (activation, setup, argon2, SQLite in asar) | `package` @ windows-latest | ⏳ pending |
| 13 | SHA-256 checksums published (`dist/SHA256SUMS.txt`) | `package` | ⏳ pending |
| 14 | GitHub Release `v1.0.0` with installer attached | `package` | ⏳ pending |

## 3. Release artifact (PENDING)

| Field | Value |
|-------|-------|
| Installer | `dist/DentivaPro-Setup-1.0.0.exe` |
| SHA-256 | _pending CI_ |
| Install location | per-user, user-selectable directory (NSIS `oneClick: false`) |
| Uninstaller | `unins000.exe` (keeps clinic data; documented policy) |
| Tested as artifact | silent install + launch + activation + setup + sign-in on Windows runner — pending |

## 4. Environment-limited items (honest disclosure)

- **Physical printer pass/fail:** no printer in this environment — print pipeline is
  covered by preview/PDF code paths; physical printing must be verified by the user
  on a real Windows printer and appended here.
- **Manual DPI/color-profile sweep on physical monitors:** checklist only (UX_SYSTEM).

## 5. Requirement sign-off

See `docs/REQUIREMENT_TRACEABILITY.md` for the full 147-section matrix.
Sign-off (§136–§146) happens only after §10–§14 are green.

## 6. Release blockers

1. GitHub re-authentication in Arena (push/CI/release) — **open**
2. CI E2E + installer + smoke green — pending (1)
3. Artifact hash recorded here — pending (2)
