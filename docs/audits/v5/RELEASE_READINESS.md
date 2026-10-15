# Dentiva Pro 5.0.0 — release readiness

**Verdict: NOT READY FOR FINAL PRODUCTION RELEASE.**

Gates A, B, C and G pass. Gate D is partial because of one open owner decision (V5-018). Gate E is partial
because nothing was printed on a physical printer. Gate F is not met: no tag, no release and no verified
installer checksum, all of which need the owner's authorization. The code is a **release candidate**
(`b40da3a`, version 5.0.0; it supersedes `56ea4cb` with the V5-033 date read-back). It has not been merged,
tagged or published.

## 1. Gates

| Gate | Status | Evidence | What is missing |
| --- | --- | --- | --- |
| **A. Build, typecheck, lint, packaging, native modules** | ✔ PASS | Local on `b40da3a`: typecheck, lint, build ✔. Windows CI: NSIS build, packaged Argon2 binding check, silent install and installed smoke ✔ on every run since `c7869bf` that reached packaging. The `c557530` runs stopped at their test failures (NSIS skipped), and `b40da3a` is green (TEST_RESULTS §3). RC run: §3 below | — |
| **B. Tests** | ✔ PASS | 57 files / 660 vitest tests on `b40da3a`. Windows verify and Electron E2E green (run 38759566953, §3). No skipped tests; no baseline or RC test deleted | Manual device checks are listed under E, not counted here |
| **C. Feature parity** | ✔ PASS (automated) | All 84 matrix rows re-verified: 55 preserved, 29 changed with issue or decision references (FEATURE_PARITY_MATRIX). No feature removed | A walk-through on a clinic PC is recommended, not blocking |
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
   - a look at a date field on a clinic PC: the date spelled out under it should match the date picked
     (V5-033; the Windows E2E checks this, so this is a confirmation, not a gate);
   - upgrade from a copy of real 4.2.x data;
   - restore of a backup;
   - a screen-reader smoke test.

## 3. Release-candidate CI run

Run 38759566953 on `b40da3a` (2026-10-15): **all jobs green.**
- verify ✔ (audit, typecheck, lint, vitest, build, marker gate);
- Electron E2E (Windows) ✔, including the V5-033 read-back test;
- NSIS installer and installed smoke ✔ (packaged Argon2 checks, silent install, smoke test, checksums).

Publishing was skipped (branch). CI artifact: `DentivaPro-Windows-NSIS`, 99,409,337 bytes, zip digest
`sha256:e20a71b70848ea4e06cdf974aecb155dec09757dbcb53f129802b3e0e2334022`, retained until 2026-11-14. This is a
branch build for verification, **not** a release asset.

The first release candidate, `56ea4cb`, was all green in run 38751182873. Between the two, `c557530` tried to fix
V5-033 with `--lang=en-GB`; Windows CI disproved it (runs 38757316130 and 38757325484, TEST_RESULTS §3), and
`b40da3a` replaced it.

Draft PR [#43](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/43) runs the same
workflow on the merge with `main`: run 38759574773 on `b40da3a` is all green. The PR is a draft and must not be
merged without authorization.

## 4. Release procedure (after authorization only)

1. Do the device checks in §2.5 with disposable data, and record the results in TEST_RESULTS.md.
2. Remove the "release candidate" block from `docs/RELEASE_NOTES_5.0.0.md`.
3. Merge the branch into `main` through a pull request. The CI publish job refuses tags that are not on `main`.
4. Tag `v5.0.0` on the merge commit and push the tag. CI rebuilds, tests, packages and publishes, and refuses to
   overwrite an existing release.
5. Record the installer name, size and SHA-256 from the tag run. Download the release asset again and compare
   the SHA-256 independently.
6. Keep `v4.2.3` and its assets unchanged.
