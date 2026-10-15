# Dentiva Pro v5 — issue register

Severity: **P0** data loss / security breach / cannot start · **P1** serious defect in a core flow or a
security weakness with a realistic path · **P2** incorrect behaviour with a workaround or limited exposure ·
**P3** quality, consistency or defence-in-depth.

Status values: `open` · `fixed` (code changed, tests added, local gates green) · `verified` (also observed in
Windows CI or another independent check) · `accepted` (documented risk, no change) · `deferred`.

Each entry records evidence (file:line at the baseline commit `303712e` unless stated), root cause, fix, the
tests that guard it, and status. Phase numbers say where the fix is scheduled.

## Security and data safety (Phase 2)

| ID | Sev | Title | Evidence | Root cause | Fix | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V5-001 | P1 | Unlock prompt allows unlimited password guesses | `src/main/core/session.ts:73-92`: `unlock()` verifies with no counter; `login()` (`services/auth.ts:92-106`) locks after `maxFailedLogins` | Lock-screen re-auth was written separately from login and never got the lockout policy | Count consecutive unlock failures; at `maxFailedLogins`, sign the user out (full login, which carries account lockout) and record the failure on the user row | integration: unlock lockout + audit rows | open |
| V5-002 | P1 | Disabled or locked accounts keep working until they sign out | `services/auth.ts:41-59` `loadSessionUser` filters only `deleted_at IS NULL`; `session.ts:103-109` reuses it on every call | Session refresh ignores `users.status` | `require()` rejects `disabled`/`locked` accounts with AUTH (ends session; renderer already handles AUTH) | integration: disable a signed-in user → next IPC call fails AUTH | open |
| V5-003 | P2 | Demo "read-only" mode misses mutating channels | `ipc/router.ts:105-123` block-list omits `chart/delete`, `accounting/delete-category`, all `whatsapp/templates/*` writes, `whatsapp/prepare*`, `whatsapp/history/status` | Block-list must be updated by hand for every new channel | Replace with an allow-list of read-only channels; unknown channels are blocked by default | unit: every non-allow-listed channel blocked in demo | open |
| V5-004 | P2 | Window navigation guard accepts any `file://` URL | `index.ts:68-70`, `print.ts:79-81` | Prefix check instead of exact-target check; the preload (bridge) is attached to whatever page the window shows | Allow navigation only to the packaged `dist/renderer/index.html` (any hash) | unit: URL predicate | open |
| V5-005 | P2 | Save-as-PDF can capture the wrong window | `print.ts:185` `BrowserWindow.getFocusedWindow() ?? printWindow` | Focus used as a proxy for "the document window" | Always export the print window; refuse when it is not open | unit (pure helper) + E2E print path | open |
| V5-006 | P2 | `clinic.logoPath` accepted from the renderer; any file in the data folder can be served as the logo | `services/settings.ts:34-51,108`; `services/auth.ts:179`; unauthenticated `settings/get` returns the data URL (`ipc/router.ts:200-210`) | Path containment checked, but not directory or file type | Renderer may only clear the logo; reads restricted to `branding/` + image extensions | integration: `dentiva.db` as logoPath → rejected / not served | open |
| V5-007 | P2 | No pre-migration safety copy of the clinic database | `db/database.ts:19-34`; `docs/DATABASE.md` promises one for destructive steps | Migrations run directly on the live file | Before applying pending migrations to an existing database, write `data/pre-migration/dentiva-v<from>-<ts>.db` with `VACUUM INTO`, verify it, keep the newest three | integration: upgrade fixture creates a verified copy; fresh install does not | open |
| V5-008 | P2 | Invoice creation trusts `visitId` / `treatmentId` from the renderer | `services/billing.ts:115,145,158-160` | IDs passed straight into SQL inserts | Validate integers, existence, same patient, visit not already invoiced | integration | open |
| V5-009 | P3 | Medicine-template save stores unvalidated items; delete throws a raw `Error` | `services/prescriptions.ts:186-211` | Backend-only path never wired to the item cleaner | Reuse the prescription item cleaner; `notFound()` | integration | open |
| V5-010 | P3 | Print-window, print and PDF channels require only a session | `ipc/router.ts:429-436,455-457` | Data reads inside the window are permission-gated, so the window opener was left open | Gate window opening by document-kind permission (defence in depth) | unit/integration permission matrix | open |
| V5-011 | P3 | Crash handlers registered late in `boot()` | `index.ts:208-215`, `index.ts:279` (`void boot()`) | Handlers added after the window is created | Register at module start; catch `boot()` rejection with the fatal dialog | review + build | open |
| V5-012 | P2 | Financial reports and payment filters treat local dates as UTC; collection report prints UTC times | `services/reports.ts:32-33,44,126,425,462-463,500-501`; `services/billing.ts:259-260` vs dashboard local-day logic `services/dashboard.ts:72` | Mixed date semantics: `paid_at` is a UTC instant, but bounds are built as `YYYY-MM-DDT00:00Z` | Convert local-day bounds to UTC instants once (shared helper); print local time | integration with TZ=Asia/Dhaka | open |

## Printing (Phase 5)

| ID | Sev | Title | Evidence | Root cause | Fix | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V5-020 | P1 | Non-A4 page sizes are active (A5, custom 20–1000 × 20–2000 mm, stored 80 mm thermal profile) | `migrations/001_init.ts:657-660`; `pages/PrintPage.tsx:22-33,247-253`; `services/settings.ts:64,234-259`; `pages/Settings.tsx:390-395,436-444`; `print.ts:152-157,196-197,239-249`; `shared/document-watermark.ts` (`PAPER_SIZES`) | Profiles own the paper size | A4-only model (single source of truth), main-process enforcement, forward migration converting stored profiles | integration + PDF geometry audit | open |
| V5-021 | P2 | Layout harness print-preview probe measured an error card | `scripts/layout-audit.mjs:233-236,294`: injected bridge calls `paged()` defined only in Node scope → "paged is not defined" | Helper not serialised into the page | Define helper inside the injected source (done in PR #42) | harness run shows document | open |
| V5-022 | P2 | PR #42 migration deletes customised non-A4 profiles (printer, copies, orientation lost) | `origin/pr-42:src/main/db/migrations/008_a4_only_printing.ts` | "Different medium → drop" policy | Convert customised legacy profiles to A4, preserving printer/copies/orientation/margins/scale; drop only untouched seeds; audit the before/after | migration fixture tests | open |
| V5-023 | P2 | PR #42 legacy detection also matches profile **names** (e.g. "custom") and would delete a real A4 profile | `origin/pr-42:src/shared/print-page.ts` (`LEGACY_NON_A4_SIZE.test(name)`) | Name heuristics | Decide by stored geometry only; names never cause deletion | unit | open |

## Design system / UX (Phase 4)

| ID | Sev | Title | Evidence | Root cause | Fix | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V5-030 | P2 | Every UI sentence is title-cased ("Item Or Procedure", "Date Of Birth", full help sentences) | `styles/global.css:15-39` shell-wide `text-transform: capitalize` | Global CSS "polish" applied to all copy | Remove the rule; author copy in sentence case; keep data verbatim | unit (stylesheet policy) + screenshots | open |
| V5-031 | P3 | Single 586 kB renderer chunk; docs claim lazy route loading | build output; `docs/ARCHITECTURE.md` §2 | No route-level code splitting | Measure first; split heavy routes if startup benefits | build size report | open |
| V5-032 | P3 | Unused Inter subsets (Cyrillic/Greek/Vietnamese) emitted | `dist/renderer/assets/inter-*` | Whole `@fontsource/inter` CSS imported | Import Latin subsets only (Bengali via Noto Sans Bengali) | build listing | open |

## Process, provenance and documentation (Phases 8–9)

| ID | Sev | Title | Evidence | Root cause | Fix | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V5-040 | P2 | v4.2.3 provenance not re-verifiable from CI records | Actions API: 0 runs / 0 check runs for `303712e` and tag `v4.2.3`; release asset digests null; PR #42 run 38721232487 → 404 | Runs unavailable (deleted or never triggered) | v5 release gate F requires a CI run on the exact tagged commit, recorded SHA-256 and an independent re-download check | release checklist | open |
| V5-041 | P3 | `main` has no branch protection | branches API `protected: false` | Repository setting | Recommend protection + required checks (owner action) | — | open |
| V5-042 | P3 | 8 moderate dev-only advisories (`sprintf-js` GHSA-hp3w-g68c-fv3c via electron-builder) | `npm audit` | Upstream; no fixed `sprintf-js` exists | Accept as build-time-only; production audit stays clean | `npm audit --omit=dev` gate | accepted |
| V5-050 | P3 | Documentation drift | `ARCHITECTURE.md` ("Linux CI job", lazy loading), `SECURITY.md` §2/§7 unresolved notes, `BUILD_STATE.md` (V1.1), `TESTING.md` | Docs not refreshed per release | v5 documentation refresh | review | open |

## Parity notes (not defects)

- Backend-only channels with no renderer caller at baseline: `prescriptions/save-template`, `appointments/get`,
  `attachments/rename`. They are kept for parity and not removed.
