# Dentiva Pro v5 — security and data-safety audit

**Date:** 2026-10-15 · **Baseline:** `303712e` (v4.2.3) · **Audited head:** `dc1534b` on
`arena/8ba688c2-dentiva-windows-application`.

This audit records what was reviewed, what was changed and what was proven by executed tests. It does **not**
claim the application is "secure". It lists the controls, the residual risks and the decisions that belong to the
owner.

## 1. Threat model (offline desktop clinic software)

| Actor or event | Example | Main controls |
| --- | --- | --- |
| Staff member with a lower role | Receptionist tries to read salaries, export data, back up the database or manage users | RBAC in the main-process service layer (`requirePermission`). IPC calls are checked per channel, and UI hiding is cosmetic |
| Administrator acting beyond their role | Grants themselves Owner permissions or deletes the Owner | Privilege ceiling, self-guard, Owner protection (V5-014/015/016, D-8) |
| Unattended PC | Someone uses a signed-in session left open | Auto-lock and manual lock, unlock attempt limit (V5-001), disabled accounts signed out (V5-002) |
| Compromised or tampered renderer | Script calls arbitrary IPC channels or navigates the window | Sandboxed renderer, context isolation, allow-listed preload API, closed IPC surface (K-01 test), navigation guard (V5-004), CSP, deny window-open, deny permission requests |
| Malicious file | Crafted attachment or backup archive | Attachment allow-list plus magic bytes, staged restore with manifest, containment and hash checks (pre-existing: attachment-security, backup-security, archive-safety) |
| Stolen backup or disk | `.dpv` or `dentiva.db` copied off the PC | **Not encrypted at rest** (documented in SECURITY.md). The owner should use BitLocker and keep backups in controlled storage |
| Failed upgrade | Migration error on the clinic's only database | Verified pre-migration copy; the upgrade fails closed (V5-007) |

## 2. Method

- **Code review** of the IPC router (all 136 channel registrations), the preload, window creation (`index.ts`,
  `print.ts`), session, auth, users, backup, settings, billing, prescriptions, chart, reports, dashboard and the
  database layer.
- **Tests** go through the same service entry points that the IPC handlers call, with explicit role contexts.
  Unauthorized calls must throw `FORBIDDEN` or `AUTH` and must write nothing.
- **Demo allow-list and print-window permissions** are tested as pure policy functions.
- **IPC surface** is checked by a permanent source-level test: one handler per channel, and no raw channels.
- **Dependencies:** `npm audit` on the production tree and on the full tree.

**Electron settings, verified in code:**
- Both windows: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `setWindowOpenHandler` denies new windows.
- `will-navigate` is guarded with `isAppEntryUrl`.
- Web-contents permission requests are denied.
- **CSP:**
  - `default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'`
  - `base-uri 'none'; form-action 'none'`
  - `style-src 'self' 'unsafe-inline'` (inline styles only; no inline scripts)
  - `img-src 'self' data: file:`

## 3. Findings and status

The full evidence (file:line, root cause and tests) is in [ISSUE_REGISTER.md](ISSUE_REGISTER.md).

| ID | Sev | Finding | Fix | Status |
| --- | --- | --- | --- | --- |
| V5-001 | P1 | Unlimited unlock attempts on the lock screen | Counter; the session ends at `maxFailedLogins` | verified |
| V5-002 | P1 | Disabled or locked accounts kept working until sign-out | Session refresh checks the account status | verified |
| V5-003 | P2 | Demo "read-only" block-list missed mutating channels | Allow-list; unknown channels are blocked | verified |
| V5-004 | P2 | Navigation guard accepted any `file://` URL | Exact packaged entry only | verified |
| V5-005 | P2 | Save-as-PDF could capture the focused window | Always the print window | verified |
| V5-006 | P2 | Renderer-supplied logo path; any data file could be served | The main process owns the path; images in `branding/` only | verified |
| V5-007 | P2 | No pre-migration copy | Verified `VACUUM INTO` copy, keeps 3, fails closed | verified |
| V5-008 | P2 | Renderer `visitId` / `treatmentId` trusted | Existence and same-patient checks | verified |
| V5-009 | P3 | Medicine-template items unvalidated | Shared item cleaner; NOT_FOUND | verified |
| V5-010 | P3 | Print window required only a session | Per-document permission | verified |
| V5-011 | P3 | Crash handlers registered late | Registered at module start | verified |
| V5-013 | P1 | `backup/run` had no permission check | `backup.create` required | verified |
| V5-014 | P1 | Role change kept old permissions; revokes impossible | Exact-set overrides | verified |
| V5-015 | P1 | Administrator could delete the (last) Owner | Owner-only; last Owner protected | verified |
| V5-016 | P2 | No privilege ceiling; last Owner could be demoted | Ceiling, self-guard, last-Owner rule | verified |
| V5-017 | P2 | Retention deleted manual and pre-restore backups | Prunes tracked automatic backups only | verified |
| V5-018 | P2 | Activation code derivable from the public repository (test helper) | **Owner decision** | open |
| V5-037 | P2 | Audit-log page filtered by UTC days | Local-day bounds | verified (CI 38750058064) |
| V5-042 | P3 | 8 moderate dev-only advisories (`sprintf-js` via electron-builder) | Accepted (build-time only) | accepted |

No P0 issues were found, and none of the P1 issues are still open.

## 4. Verification (executed)

| Check | Result | Where |
| --- | --- | --- |
| `tests/integration/v5-security.test.ts` | 27 tests pass | local + Windows CI verify |
| `tests/unit/access-policy.test.ts` | 11 tests pass | local + CI |
| `tests/unit/ipc-surface.test.ts` | 4 tests pass | local + CI |
| Existing security suites (rbac, rbac-personas, attachment-security, backup-security, archive-safety, auth) | pass, unchanged except the ISS-010 owner self-demotion case (D-8) | local + CI |
| `npm audit --omit=dev --audit-level=moderate` | **0 vulnerabilities** (2026-10-15) | local; also a CI verify step |
| `npm audit` (full tree) | 8 moderate, all `sprintf-js` via electron-builder (dev and build only) | local |
| Windows CI | Run 38741516954 (1467d56): all jobs green after the Phase 2 fixes. Later runs are listed in [TEST_RESULTS.md](TEST_RESULTS.md) | GitHub Actions |

**Fail-before evidence:**
- The Phase 2 tests were written against the reported behaviour. Each V5 security test exercises the exact
  path from the finding.
- The V5-037 and print tests were also run against the old code and failed there (recorded in the commit
  messages).

## 5. Residual risks and owner decisions

1. **V5-018 activation:**
   - The offline code can be derived from the public test helper.
   - Activation is a soft gate (SECURITY.md §6), not patient-data protection.
   - Changing it (rotating the code into a CI secret, or signed per-installation licences) changes who can
     activate. That needs the owner's decision.
2. **Data at rest is not encrypted.** `dentiva.db`, attachments and `.dpv` backups rely on Windows account
   security. Recommend BitLocker and controlled backup storage.
3. **Branch protection (V5-041):** `main` accepts direct pushes. Recommend protection with required CI checks.
4. **Not run here:** physical-device checks of Windows secure storage (DPAPI) behaviour, installer ACLs and an
   authenticated penetration test.
