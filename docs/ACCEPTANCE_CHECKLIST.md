# Dentiva Pro — Acceptance Checklist (spec §136 / V1.1 gates)

Source: master specification acceptance list, tracked 1:1 with the V1.1 audit
(`docs/V1.1_AUDIT_PLAN.md` §7 and `docs/V1.1_ISSUE_REGISTER.md`).
Status values: `[x]` evidenced · `[ ]` pending.

## A. Product & architecture

- [x] Architecture audit complete (V1.1 Phase A; ADR-001; docs/ARCHITECTURE.md)
- [x] Offline-first, no paid APIs, no runtime network code (code audit + CSP `connect-src 'none'`)
- [x] Product identity, icon, versioning (icon.ico 16–256; version from package.json)
- [x] Documentation set exists and references resolve (THIRD_PARTY_NOTICES.md, this file)

## B. Security & identity

- [x] Activation audit complete (integration + packaged-artifact smoke; repo literal scan; failed attempts audited — ISS-011)
- [x] Authentication audit complete (Argon2id, lockout, timing equalization, audit)
- [x] Auto/manual lock (main-process idle timer + denied IPC while locked)
- [x] No plaintext passwords/secrets in source, logs, tests, artifacts (CI + manual scans)
- [x] Security review (docs/SECURITY.md + V1.1 Phase A; CSV injection fixed ISS-009; attachment write gates ISS-018)
- [x] Audit log append-only; tamper attempts rejected at DB level (triggers)

## C. RBAC & permissions

- [x] RBAC service-layer enforcement (requirePermission on every service entry point)
- [x] Owner-account protection (ISS-010)
- [ ] RBAC matrix fully populated from behavior for all 6 personas (Phase B)
- [ ] Unauthorized-persona attack suite complete (financial/salary/users/destructive/audit/backup) (Phase B)

## D. Clinical & workflow

- [x] Patient creation/duplicates (integration + E2E incl. Bengali)
- [x] Visit history immutability (closed-visit guard)
- [x] Dental chart history preserved (supersede-only design + integration)
- [x] Prescription create validation (items, dentist, dates — ISS-013)
- [ ] Appointment lifecycle matrix (Phase B tests: conflict, override, reschedule)
- [ ] Queue state machine matrix incl. 30+ entries (Phase B)
- [ ] Prescription print PDF matrix (A4/A5/thermal, Bengali, long content) — CI-rendered where possible; physical printer = environment-unavailable

## E. Financial

- [x] Total = Paid + Due invariant (ISS-008 fix + tests; billing suite)
- [x] Refund permission + refund bound (ISS-008)
- [x] Append-only payments/invoice_items (DB triggers)
- [x] Historical price immutability (invoice items snapshot unit price)
- [ ] Report accuracy vs hand-computed dataset (Phase B)
- [ ] Payment method matrix incl. bKash/Nagad/Rocket/Upay (Phase B)

## F. Operations

- [x] Backup: checksum + integrity + unique names + truthful list (ISS-012)
- [x] Restore: pre-restore backup, rollback, corrupt rejection (integration)
- [x] Attachments: extension/magic-byte/traversal/size defenses; write permissions (ISS-018)
- [ ] Inventory negative-stock/expiry/low-stock matrix (Phase B)
- [ ] Accounting income/expense totals vs source (Phase B)
- [ ] Search permission redaction matrix (Phase B)

## G. UI/UX (environment-limited where noted)

- [x] Empty/loading/error states present (components + E2E)
- [x] No fake buttons/TODO/dead code in release (CI grep gate + Phase A sweep)
- [ ] Full visual polish pass (Phase D re-audit; pixel-level review limited in headless env)
- [ ] High-DPI 100–200% sweep — **environment unavailable** (documented, never claimed)
- [ ] Physical printer pass/fail — **environment unavailable** (documented, never claimed)

## H. Release

- [x] CI verify + E2E + NSIS installer + installed-artifact smoke green (runs 36369672016, 36393753841)
- [x] PR checks wired (pull_request trigger, guarded side-effects) — ISS-003
- [x] V1.0.0 released with checksums (tag v1.0.0, hash triangulated)
- [ ] V1.1.0 version bump, artifact test, release (Phase E)
- [ ] Requirement traceability revalidated at V1.1 (final pass in Phase D)
- [ ] Second independent audit complete (Phase D)
