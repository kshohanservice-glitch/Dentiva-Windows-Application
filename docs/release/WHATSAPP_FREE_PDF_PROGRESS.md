# Dentiva Pro — Free WhatsApp Messaging & PDF Sharing progress

Durable checkpoint. Update after each major milestone. Do not claim
completion for steps that have not actually run.

## Baseline (verified 2026-10-14)

| Item | Value |
| --- | --- |
| Verified v4.0.0 baseline commit | `5cbd9e285dfaadf15b7c956faa855eb4a7a75acb` (annotated tag `v4.0.0`, tag object `a817b947d87ad8039a3ac119aecff6221f9d07fa`) |
| Existing releases (must stay untouched) | v4.0.0 (latest), v3.1.0, v3.0.3, v3.0.2, v3.0.1, v3.0.0, v2.0.10 … — verified with `gh release list`; no asset will be replaced, no tag moved |
| Working branch | `arena/8b64ec9e-dentiva-windows-application` (Arena session branch, branched from the verified v4.0.0 commit; the suggested `feature/free-whatsapp-pdf-sharing` name is not used because this session is bound to its Arena branch) |
| Target version / tag / installer | `4.1.0` / `v4.1.0` / `DentivaPro-Setup-4.1.0.exe` — checked unused: no `v4.1.0` tag or release exists |
| Installer technology | electron-builder NSIS x64 (`electron-builder.yml`), `DentivaPro-Setup-${version}.exe` |
| CI | `.github/workflows/ci.yml`: verify (typecheck, lint, vitest, audit) → Electron E2E → Windows package (NSIS build, silent install, installed-app smoke test, SHA-256). Releases publish only from a `v*` tag whose commit is on `main` and whose version matches `package.json` |

## Architecture findings (from repository inspection)

- Electron + React + better-sqlite3. Migrations in `src/main/db/migrations/` (001–005, `user_version` pragma). Additive-only convention.
- Patient phone today is Bangladesh-local (`normalizePhone` in `src/main/core/validate.ts`); the new WhatsApp number is stored separately in international digits.
- Existing printable patient documents (PrintPage kinds): `prescription`, `prescription-duplicate`, `invoice`, `receipt`, `visit-summary`, `appointment-card`. Reports and stock labels are not patient documents and are excluded from the patient registry.
- PDF generation today is the Print window (`reports/print` opens it, `print/pdf` saves). The WhatsApp flow reuses exactly this; Click to Chat cannot attach files, so the doctor attaches the saved PDF manually.
- Backup (`.dpv`) archives the whole SQLite database, so new tables/columns are carried automatically; restore validates required tables only.
- Permissions are reused (`patients.view/edit`, `settings.manage`, …); no new permission keys, so no role-seeding migration is needed.

## Implementation decisions

- Pure logic in `src/shared/whatsapp.ts` (normalization, greeting, templates, placeholder rendering, `wa.me` URL) — unit-testable without Electron.
- Migration `006_whatsapp`: nullable `patients.whatsapp_number`, `whatsapp_same_as_phone`, consent columns; `whatsapp_templates` (defaults seeded with `INSERT OR IGNORE`, never overwritten); `whatsapp_message_log` (preparation history with user-reported status only — never a delivery claim).
- Main service `src/main/services/whatsapp.ts`: patient document registry (permission-aware, patient-isolated), template CRUD, message preparation (validates appointment/document ownership, consent, number), document-share preparation (organized folder under the app temp dir with a manifest; PDFs themselves are produced by the existing Print → Save PDF flow), history.
- External opening only through `shell.openExternal` after strict `https://wa.me/<digits>` validation in the main process.
- UI stays English; Bengali appears only inside message-template bodies and the outgoing-message preview.

## Milestones

- [x] Repository, tags, releases, CI and architecture inspected; baseline recorded
- [x] Shared WhatsApp engine (`src/shared/whatsapp.ts`)
- [x] Migration 006 + patient fields
- [x] Main WhatsApp service + IPC + settings section
- [x] Renderer: registration form field, Patient Profile "WhatsApp & Documents" hub, Settings "Message Templates"
- [x] Version 4.1.0 + release notes (`docs/RELEASE_NOTES_4.1.0.md`)
- [x] Unit + integration tests; full local gates (typecheck, lint, vitest, build, audit)
- [ ] Push session branch; Windows CI (verify, E2E, installer, smoke test)
- [ ] Pull request merged to `main`; tag `v4.1.0`; CI publishes release
- [ ] Verify published release page, assets and SHA-256; verify v4.0.0 untouched

## Files changed

- New: `src/shared/whatsapp.ts`, `src/main/db/migrations/006_whatsapp.ts`, `src/main/services/whatsapp.ts`, `src/renderer/components/whatsapp-hub.tsx`, `src/renderer/components/message-templates.tsx`, `tests/unit/whatsapp.test.ts`, `tests/unit/whatsapp-ui-language.test.ts`, `tests/integration/whatsapp.test.ts`, `docs/RELEASE_NOTES_4.1.0.md`, this checkpoint.
- Modified: `src/main/db/migrations/index.ts`, `src/main/core/validate.ts`, `src/main/services/patients.ts`, `src/main/services/settings.ts`, `src/main/ipc/router.ts`, `src/shared/types.ts`, `src/shared/ipc.ts`, `src/renderer/pages/Patients.tsx`, `src/renderer/pages/Settings.tsx`, `package.json`, `package-lock.json` (version only).

## Test results (actual, Linux sandbox 2026-10-14)

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/whatsapp.test.ts tests/integration/whatsapp.test.ts` | 45 passed (30 unit + 15 integration) |
| `npm test` (full suite) | **35 files / 355 tests passed** (v4.0.0 baseline: 308) |
| `npm run typecheck` (renderer + node) | pass |
| `npm run lint` | pass, 0 errors |
| `npm run build` | pass |
| `npm audit --omit=dev --audit-level=moderate` | 0 vulnerabilities |

## Known problems / blockers

- The Linux sandbox cannot download an Electron binary, so local Electron E2E and a local Windows installer build are impossible; Windows CI is the installer gate (same limitation as v4.0.0).

## Exact next action

Commit, push the session branch, and watch Windows CI (verify → E2E → installer + installed-app smoke test). Then open the pull request to `main`; after merge, push tag `v4.1.0` so CI publishes the release, and verify the release page, assets and SHA-256.
