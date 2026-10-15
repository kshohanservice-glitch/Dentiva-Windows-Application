# Dentiva Pro — testing and release gates

This is a map of executable checks, **not** a claim that all device-level checks have passed. For exact commit-specific outcomes see `RELEASE_EXECUTION_JOURNAL.md`.

## Automated local tests

- `npm run typecheck` checks renderer and main TypeScript projects.
- `npm run lint` runs ESLint (clean: 0 errors, 0 warnings).
- `npm test` runs Vitest unit and integration suites against disposable migrated SQLite databases.
  Regression suites for the 4.0.0 fixes live in `tests/unit/print-money.test.ts`
  (real amounts in printed documents, no `@media` swap, no hardcoded values),
  `tests/unit/search-hit-row.test.ts` (fixed label column, no clipping, category
  coverage, keyboard nav) and `tests/unit/branding.test.ts` +
  `tests/integration/branding.test.ts` (clinic identity on Login/dashboard, broken
  logo fallback, branding round-trip through backup/restore). Coverage includes v3.0.3 and v4.2.2 fixture upgrades (`tests/fixtures/v4.2.2/dentiva-v4.2.2.db`, rebuilt by `scripts/build-v422-fixture.mjs`, proves the A4-only print-profile rewrite on a database written by the published version), legacy Queue preservation, appointment expiry/reschedule, backup/restore tamper/rollback cases, money masking rules, RBAC, financial reconciliation, template permissions/validation, and a 20,000-patient synthetic query fixture. A passing 20k-patient fixture is **not** a benchmark for 60k visits or 100k invoices.
- v5 suites (2026-10): `tests/integration/v5-security.test.ts` (account, session, backup, logo,
  pre-migration and link-validation hardening), `tests/unit/access-policy.test.ts` (demo
  allow-list, print-window permissions), `tests/integration/v5-local-dates.test.ts` (local-day
  filters, `TZ=Asia/Dhaka`), `tests/integration/v5-print-chain.test.ts` (printed report totals,
  multi-page rules, fonts), `tests/unit/v5-accessibility.test.ts` (WCAG contrast computed from
  `tokens.css`, names/roles) and `tests/unit/ipc-surface.test.ts` (every IPC channel has exactly
  one handler). Results per commit: `docs/audits/v5/TEST_RESULTS.md`.
- `npm run build` compiles the main process and renderer.
- `npm audit --omit=dev --audit-level=moderate` checks known production dependency advisories at the time of the run.

Linux installation requires the documented `npm_config_nodedir=/usr/local npm ci --force` workaround for the Windows-only Argon2 dependency. Local `npm run test:e2e` cannot launch in this sandbox when the Electron binary cannot be downloaded; this does not count as an E2E pass.

## Layout, print and accessibility harness (`scripts/layout-audit.mjs`)

Runs the production renderer bundle (`npm run build:renderer`) in a Chromium with a stubbed bridge.
Set `LAYOUT_BROWSER` (and `LAYOUT_BROWSER_LIBS` if the browser needs extra libraries).

- default: 24 screens and modal scenarios × 8 viewports (2560 → 480 px) — overflow, clipping and
  overlap checks; `--theme dark`; `--screens` writes screenshots to `layout-audit/` (git-ignored).
- `--pdf <dir>`: every printable document rendered in the print window, page box measured, PDF
  written and checked for A4 geometry; `--long` uses long fixtures for pagination checks.
- `--axe <path to axe.min.js>`: axe-core WCAG 2.0/2.1 A + AA scan of every screen and modal
  (axe-core is not a project dependency; install it separately). The app CSP stays enforced.

The harness is evidence about the renderer in Chromium, not about Electron's print path, a
Windows printer or a screen reader.

## Windows CI

`.github/workflows/ci.yml` runs verify and real Electron Playwright E2E on Windows. Its package job runs **only after both pass**, builds an x64 NSIS installer, checks packaged native Argon2, silently installs the actual installer, runs `scripts/smoke-installed.mjs`, computes SHA-256 and uploads the installer/checksum as an Actions artifact. These checks are commit-specific: a passing run from before a migration or UI change does **not** verify the later commit. A branch push never publishes a release.

The serial E2E suite covers activation/setup/login, patient entry and chart, invoice/payment money reveal, appointment move and override, prescription and invoice print windows (including the real-amount/no-`****` assertion and the global-search column-overlap assertion), reports, visit completion, deletion and screen sizes. Tests do not replace manual accessibility review or long-content print testing.

## Manual release checks still needed

- Upgrade and restore disposable copies of clinic data on target Windows devices; preserve pre-upgrade backup and historical finance/clinical records.
- Real printer/PDF content (including Bengali glyphs), A4 portrait/landscape margins and profile padding, long-page pagination, installed DPI and 1180×720 / 1920×1080 interactions.
- Rehearse install/uninstall and data retention on a clinic-equivalent Windows machine; inspect permissions and secure-storage behavior without modifying the user's only data copy.
- Check unsaved-change navigation, duplicate-action guards, all template kinds, screen-reader operation and staff-role privacy end to end.

Never mark a skipped or blocked gate as passed. Tag/release only a unique version after all required automated checks and critical device-level signoffs are accounted for. The previous `v3.0.3` tag/assets remain immutable.
