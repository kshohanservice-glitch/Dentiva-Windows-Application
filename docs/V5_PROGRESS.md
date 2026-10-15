# Dentiva Pro v5.0.0 "Premium Flagship" — progress log

This log is the recovery record for the v5 effort. A task is marked done only when its result was observed.

**To continue after an interruption:**
1. Read this file.
2. Verify `git status`, the branch, `HEAD` and the recent commits.
3. Trust repository evidence over this text, and correct the log if the two disagree.
4. Resume from the earliest unfinished dependency.
5. Update this log at the end of the session.

## 1. Current phase

**Phase 9: release candidate and handoff.** Phases 0–8 are done. Version 5.0.0 is a release candidate, now at
`b40da3a`. That commit supersedes the first candidate `56ea4cb` with the V5-033 date read-back. It is **not**
merged, tagged or published. The verdict is **NOT READY FOR FINAL PRODUCTION RELEASE**, for the reasons in
`docs/audits/v5/RELEASE_READINESS.md`.

**Latest session (2026-10-15, "Continue" without owner decisions):** V5-033 resolved.
- The first attempt, `c557530`, pinned Chromium's locale with `--lang=en-GB`. Windows CI disproved it: the
  native date field still read Month, Day, Year.
- `b40da3a` removed the switch. Each form date field now spells out the chosen date underneath.
- Windows CI on `b40da3a` is all green (run 38759566953).
- No owner decision was made or assumed.

## 2. Branch

- `arena/8ba688c2-dentiva-windows-application` is the Arena session branch and the v5 development branch (D-1).
  Arena ties the session to this branch name, so the preferred name `v5/premium-flagship` was not used.
- `main` was never committed to and is unchanged at `303712e`.

## 3. Baseline and HEAD

- **Baseline:** `main` = tag `v4.2.3` = `303712e489d9747bf6769ce1fd7f3705f5604883`.
- **Release-candidate code commit:** `b40da3a` (5.0.0). The first candidate was `56ea4cb`.
- **Commits since the baseline, in order:**

| Commit | Change |
| --- | --- |
| `e295c28` | baseline docs |
| `119ab7b` | register |
| `dd81c08` | PR #42 merge |
| `8e0a336` | security |
| `1467d56` | local-day reports |
| `f141c0e` | profile conversion |
| `f148208` | design system |
| `1cf5a6e` | E2E locator |
| `c7869bf` | multi-page print and report totals |
| `22e6802` | fonts and headings |
| `5eda3af` | accessibility |
| `dc1534b` | audit filter and IPC surface |
| `df8a499` | docs |
| `56ea4cb` | 5.0.0 release candidate |
| `338a6b8`, `093af95` | docs (gates, readiness, PR #43) |
| `c557530` | V5-033 first attempt: `--lang=en-GB`, explicit display locales, appointment-card time (switch disproved by CI) |
| `b40da3a` | V5-033 fix: date read-back; switch removed (current release-candidate code) |

## 4. Working-tree status

Clean after each commit. Generated output is git-ignored: `layout-audit/`, `dist/`, `node_modules/`. PDFs and
logs were written under `/tmp`, outside the repository.

## 5. Work completed

| Phase | Result |
| --- | --- |
| 0 Baseline | Git/GitHub/CI inventory; baseline gates: 48 files / 549 tests, 0 production advisories, layout 0/144; screenshots reviewed (BASELINE_AUDIT) |
| 1 Audit | Issue register, now 39 entries; feature-parity matrix with 84 rows |
| 2 Security and data | V5-001…017 fixed and Windows-CI-verified; local-day dates (V5-012); later the audit-log filter (V5-037) |
| 3 Core and architecture | Shared date helpers, access policy, navigation guard, pre-migration copy; IPC surface pinned by a permanent test (K-01). Route splitting measured and declined (V5-031) |
| 4 Design system | Semantic tokens, sentence case (V5-030), `enumLabel`, StatCard as a button, calmer components, Bengali typography, dashboard permission fix (V5-034) |
| 5 A4 printing | PR #42 merged and corrected (V5-020…023); fonts (V5-025); multi-page margins and pagination (V5-026); report totals (V5-027); stranded headings (V5-028); PDF audit, normal and long |
| 6 Parity regression | All 84 rows re-verified (55 preserved, 29 changed with references); matrix error C-04 corrected. K-07 (date entry) added for V5-033 |
| 7 Performance, accessibility, hardening | Font subsets −23 % (V5-032); axe-core WCAG 2.1 AA scan with 0 violations in both themes (V5-035); boot-cost measurement (V5-031) |
| 8 Final audit | Full gates re-run on the release candidate; claims in the docs re-checked against the code (found and fixed V5-037, the C-04 matrix error, the V5-008 wording, the wrong logger/errors paths in the parity notes) |
| 9 Release candidate | Version 5.0.0, release notes, readiness report; chunk-size warning made visible. After the first candidate: V5-033 resolved (`b40da3a`) |

## 6. Files changed

`git diff --stat 303712e..HEAD` is the authoritative list.

| Area | Files |
| --- | --- |
| Main process | `core/session.ts`, `core/dates.ts` (new), `core/validate.ts`, `ipc/access-policy.ts` (new), `ipc/router.ts`, `navigation.ts` (new), `index.ts`, `print.ts`, `db/database.ts`, `db/migrations/008_a4_only_printing.ts` |
| Services | auth, users, backup, settings, billing, prescriptions, chart, visits, reports, dashboard |
| Shared | `print-page.ts`, document-watermark, settings types |
| Renderer | `styles/tokens.css`, `global.css`, `print.css`, `format.ts`, `main.tsx`, `components/` (primitives, shell, ToothChart, forms), `documents/` (print-documents, document-preview), pages (Users, Dashboard, Patients, Settings, Appointments, QuickDocuments, PrintPage and others), `state/app-context.tsx` |
| Tests | new `v5-security`, `access-policy`, `v5-local-dates`, `v5-print-chain`, `v5-accessibility`, `ipc-surface`, `v5-locale`; updated a4-only-printing, document-layout, migration-v422, audit-regressions (ISS-010), branding, search-hit-row, ui-layout-regressions, E2E `app.spec.ts` |
| Tooling | `scripts/layout-audit.mjs` (`--theme dark`, `--long`, `--axe`, New appointment modal scenario), `vite.config.ts` |
| Docs | `docs/audits/v5/*` (7 files), `V5_PROGRESS.md`, `RELEASE_NOTES_5.0.0.md`, SECURITY, PRINTING, DATABASE, ARCHITECTURE, TESTING, KNOWN_LIMITATIONS; superseded banners on the 4.3.0 docs |

## 7. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D-1 | Use the session branch for v5; leave `arena/v5-premium-flagship` untouched | Arena binds the session to its branch; the other branch equals `main` |
| D-2 | Reuse closed PR #42 (A4-only groundwork) through an explicit `--no-ff` merge, then correct it | It implements the A4 requirement with tests. Its defects were corrected (V5-022, V5-023). The version becomes 5.0.0, not 4.3.0 |
| D-3 | Legacy non-A4 print profiles are converted to A4, not deleted. Names never trigger deletion | Do not silently destroy user customisation |
| D-4 | Local verification uses headless Chromium 153. Electron E2E, NSIS and installed smoke tests come only from Windows CI on the exact commit | No Electron binary or display in the sandbox |
| D-5 | Physical printer output is never claimed as verified | No hardware |
| D-6 | Refines D-3. Page-like media (A5, Letter, custom ≥ 120 mm) keep printer, orientation, margins, scale and copies. Roll media (thermal or < 120 mm) keep copies and orientation; printer is cleared and margins and scale reset. Untouched seeds `rx-a5` and `inv-thermal` are dropped. Converted profiles are named "… A4 (converted)" with unique ids that never collide with the built-ins. The audit row keeps the full before-state | A roll printer's settings are wrong for A4; page-media settings are still valid |
| D-7 | `visits.datetime` is local wall-clock time (trailing Z historical, no data migration). Payment and audit timestamps are UTC instants filtered by local-day bounds | Matches how every visit was stored; avoids rewriting clinical data |
| D-8 | Nobody changes their own role, status or overrides. The last active Owner is protected. Non-owners have a privilege ceiling. The ISS-010 owner self-demotion test now expects refusal | Prevents lock-out and privilege escalation |
| D-9 | `enumLabel` formats enum values only. Patient and clinic data stay verbatim | No silent rewriting of user data |
| D-10 | Printed document markup stays frozen (`document-layout` tests). Printed invoice status stays lowercase | The layout contract outweighs a cosmetic change |
| D-11 | The demo allow-list also blocks `whatsapp/prepare*` and `quick-documents/prepare` | They write files or open external flows |
| D-12 | No route code-splitting (V5-031, measured). Vite's chunk-size warning is shown, not hidden | About 41 ms boot script from local disk; do not suppress warnings |
| D-13 | Keep the pre-existing no-op invoke handler on `event/session-expired` and pin it in the IPC surface test | Parity; it is unreachable from the preload |
| D-14 | A second invoice for an already-invoiced visit stays allowed; the visit keeps its first link | Changing it would alter a billing rule (needs the owner) |
| D-15 | axe-core is not a project dependency. The harness takes a path to a separate install | No new supply-chain surface for a dev-only check |
| D-16 | V5-033: no app locale switch. Each form date field spells out the chosen date underneath ("Fri 3 Apr 2026"); filter bars are unchanged. Displays that used the machine locale pass `'en-GB'`. The printed appointment card shows a 12-hour time in the English (US) style | Windows CI showed `--lang=en-GB` does not change native date fields when the Windows regional format is English (Blink `locale_win.cc`). A read-back is unambiguous on every PC and keeps the native field, its value format and keyboard entry. The card keeps what an English (US) PC printed before (D-10) |

## 8. Findings

There are 39 issues in `docs/audits/v5/ISSUE_REGISTER.md`:

| Status | Count | Issues |
| --- | --- | --- |
| verified | 32 | — |
| fixed | 1 | V5-050, docs |
| accepted | 2 | V5-031, V5-042 |
| open | 4 | V5-018, V5-036, V5-040, V5-041 |

There is no open P0 or P1.

Key finding from V5-033: on Windows, native date fields use the PC's own short date format whenever the app
language and the Windows regional format are both English, and no app locale switch changes that.

## 9. Tests and checks run

- **Local on `b40da3a`:** typecheck, eslint, vitest, build, production `npm audit`, marker grep. The full audit and
  boot proxy were last run on `56ea4cb`.
- **V5-033 extras:** the tests under an en-GB Node locale and in a CRLF copy of the tree, plus mutation checks.
- **Harness:** layout light and dark, the A4 PDF audit (normal and `--long`) inspected with PyMuPDF, axe-core in
  light and dark, and the boot-cost proxy.
- **Windows CI:** twelve runs on this branch, push and pull_request, listed in TEST_RESULTS.md §3.

## 10. Results

- **Local:** 57 files / 660 tests pass; typecheck and lint are clean; the build passes with one documented
  warning; 0 production advisories.
- **Harness (renderer of `b40da3a`):** layout 0/200 in light and dark; A4 0 violations in 16 normal and 16 long
  PDFs; axe 0/0 over 25 screens.
- **Windows CI:** green on `c7869bf`, `5eda3af` and `dc1534b`, and on the **release candidate `56ea4cb`** (run
  38751182873: verify, Electron E2E, NSIS and installed smoke all ✔; publish skipped).
- **Windows CI on the current candidate `b40da3a`:** run 38759566953, all ✔ (verify, E2E with the V5-033 test,
  NSIS and installed smoke; publish skipped).
- **Draft PR #43** (merge with `main`): run 38759574773 on `b40da3a` all ✔. It is not merged.

## 11. Failures

- **CI 38744605558 (`f148208`):** the E2E strict-mode locator matched two "Paid" texts. Fixed in the test
  (`1cf5a6e`); green since.
- **CI 38757316130 and 38757325484 (`c557530`):**
  - E2E: the date field still read Month, Day, Year, which disproved the `--lang=en-GB` approach.
  - verify: a new unit test searched for `…;\n`, which never matches a CRLF checkout on Windows.
  - Both fixed in `b40da3a`. The CRLF case is now simulated locally before pushing.
- **Local, caught before push:**
  - a renderer type error in the report summary (`c7869bf`);
  - a wrong `createPatient` field in a new test;
  - the PDF completeness script's regex (a tooling bug, not a product bug).

## 12. Outstanding work

- Device checks (A4 printing, Save-as-PDF, upgrade from real data, restore, screen reader; a look at the date
  read-back is a confirmation only).
- Owner decisions (§16).
- After authorization: merge, tag, publish, then record and re-verify the installer SHA-256.
- Optional CI maintenance: Node 24 action majors.

## 13. Blockers

- No Windows device or printer in this environment (Gate E partial).
- Release authorization (Gate F).
- The V5-018 decision (Gate D partial).
- CI logs and artifacts are on blocked storage, so installer checksums cannot be re-verified from here.

## 14. Release gate status

| Gate | Status |
| --- | --- |
| A | PASS |
| B | PASS |
| C | PASS (automated) |
| D | PARTIAL (V5-018) |
| E | PARTIAL (no physical printer) |
| F | NOT MET (needs authorization) |
| G | PASS |

**NOT READY FOR FINAL PRODUCTION RELEASE.**

## 15. Next steps

1. The owner decides the §16 items.
2. Device checks on a clinic PC with a printer, using disposable data.
3. If authorized: follow RELEASE_READINESS §4, which covers the notes banner, the PR merge to `main`, tag
   `v5.0.0`, the CI publish run and the SHA-256 re-check.

## 16. Decisions requiring the user

1. **V5-018:** accept the activation exposure, rotate the code into a CI secret, or move to signed licences.
2. **Authorization** to merge into `main`, tag `v5.0.0` and publish.
3. **V5-036:** window minimum 1180 × 680 versus small scaled screens.
4. **V5-041:** branch protection on `main`.

**Release-candidate CI:** run 38759566953 on `b40da3a`, all jobs green (RELEASE_READINESS §3). The first
candidate `56ea4cb` was green in run 38751182873.
