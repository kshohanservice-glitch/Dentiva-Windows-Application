# Dentiva Pro 5.0.0 — release readiness

**Verdict: NOT READY FOR FINAL PRODUCTION RELEASE.**

Gates A, B, C and G pass. Gate D is partial because of one open owner decision (V5-018). Gate E is partial
because nothing was printed on a physical printer. Gate F is not met: no tag, no release and no verified
installer checksum, all of which need the owner's authorization. The code is a **release candidate**
(`56ea4cb`, version 5.0.0). It has not been merged, tagged or published.

## 1. Gates

| Gate | Status | Evidence | What is missing |
| --- | --- | --- | --- |
| **A. Build, typecheck, lint, packaging, native modules** | ✔ PASS | Local on `56ea4cb`: typecheck, lint, build ✔. Windows CI: NSIS build, packaged Argon2 binding check, silent install and installed smoke ✔ on every run since `c7869bf` (TEST_RESULTS §3). RC run: §3 below | — |
| **B. Tests** | ✔ PASS | 56 files / 646 vitest tests on `56ea4cb`. Windows verify and Electron E2E green (RC run §3). No skipped or deleted tests | Manual device checks are listed under E, not counted here |
| **C. Feature parity** | ✔ PASS (automated) | All 83 matrix rows re-verified: 55 preserved, 28 changed with issue or decision references (FEATURE_PARITY_MATRIX). No feature removed | A walk-through on a clinic PC is recommended, not blocking |
| **D. Security and data** | ◐ PARTIAL | 17 security findings verified, plus V5-037. Production audit clean. Pre-migration copy fails closed (SECURITY_AUDIT) | **V5-018** activation exposure needs an owner decision. Data at rest is not encrypted (documented; BitLocker recommended). No penetration test |
| **E. A4 printing** | ◐ PARTIAL | 13 documents + 3 landscape views A4 in the Chromium PDF chain, normal and long. Margins on every sheet, totals printed, ৳ embedded (PRINTING_A4_AUDIT) | **Physical printer output** and Electron `printToPDF` geometry on Windows are not verified |
| **F. Provenance** | ✘ NOT MET | Version 5.0.0 in package.json and the lockfile. CI for every pushed code commit. Branch artifact digests recorded | Merge to `main`, tag `v5.0.0` on that commit, CI publish run on the tag, installer SHA-256 from that run, independent re-download check. **All need authorization** |
| **G. Docs and handoff** | ✔ PASS | V5_PROGRESS, BASELINE_AUDIT, FEATURE_PARITY_MATRIX, ISSUE_REGISTER, PRINTING_A4_AUDIT, SECURITY_AUDIT, TEST_RESULTS, this file, RELEASE_NOTES_5.0.0, refreshed SECURITY / PRINTING / DATABASE / ARCHITECTURE / TESTING / KNOWN_LIMITATIONS | — |

## 2. Owner decisions needed

1. **V5-018: activation code exposure.** Pick one:
   - accept it, since activation is a soft gate;
   - rotate the code and keep it as a CI secret for tests;
   - move to signed per-installation licences.

   The last two change who can activate.
2. **Release authorization:**
   - merge `arena/8ba688c2-dentiva-windows-application` into `main`;
   - tag `v5.0.0`;
   - allow the CI publish job to create the release.
3. **V5-036: window minimum.** Keep 1180 × 680, or lower it so 1366 × 768 at 125 % fits. The layouts pass down to
   480 px; the window minimum is a documented product choice.
4. **V5-041:** enable branch protection on `main`, with the `CI` checks required.
5. **Device checks (assign someone with a clinic PC and printer):**
   - A4 print set: portrait, landscape and long documents;
   - Save-as-PDF;
   - date-input locale (V5-033);
   - upgrade from a copy of real 4.2.x data;
   - restore of a backup;
   - a screen-reader smoke test.

## 3. Release-candidate CI run

Run 38751182873 on `56ea4cb` (2026-10-15): **all jobs green.**
- verify ✔ (audit, typecheck, lint, vitest, build, marker gate);
- Electron E2E (Windows) ✔;
- NSIS installer and installed smoke ✔ (packaged Argon2 checks, silent install, smoke test, checksums).

Publishing was skipped (branch). CI artifact: `DentivaPro-Windows-NSIS`, 99,409,026 bytes, zip digest
`sha256:9282efa1d636a38567588fcdee046a07b69deac2cfa3e249bf3145edb9e36c48`, retained until 2026-11-14. This is a
branch build for verification, **not** a release asset.

## 4. Release procedure (after authorization only)

1. Do the device checks in §2.5 with disposable data, and record the results in TEST_RESULTS.md.
2. Remove the "release candidate" block from `docs/RELEASE_NOTES_5.0.0.md`.
3. Merge the branch into `main` through a pull request. The CI publish job refuses tags that are not on `main`.
4. Tag `v5.0.0` on the merge commit and push the tag. CI rebuilds, tests, packages and publishes, and refuses to
   overwrite an existing release.
5. Record the installer name, size and SHA-256 from the tag run. Download the release asset again and compare
   the SHA-256 independently.
6. Keep `v4.2.3` and its assets unchanged.
