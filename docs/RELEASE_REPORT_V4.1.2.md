# Dentiva Pro — Release report 4.1.2

- **Product:** Dentiva Pro 4.1.2 — offline Windows dental clinic management (Bangladesh)
- **Developer:** Shohan Khan — helloiamshohan@gmail.com
- **Working branch:** `arena/ed773b64-dentiva-windows-application` (never `main`)
- **Pull request:** [#28](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/28) → `main`, merged 2026-10-14T09:24:15Z
- **Merge commit on `main`:** `6f06351acd60f003b85a7d1dd5d4bdfb457e0287`
- **Tagged commit:** `b86a1a34412e6aa293c172ad14ea53d3e6c0dd70` (the commit the Windows pipeline verified)
- **Tag:** `v4.1.2` — annotated tag object `6c2fd1ea4d5abf7f270afdd0510d02ea424c6d34` → `b86a1a3`
- **Release:** https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v4.1.2 (published 2026-10-14T09:30:49Z, marked *Latest*)
- **Report date:** 2026-10-14
- **Status: RELEASED** — every row below is backed by a run, a job or an API value recorded during this
  release; items that could not be executed in this environment are listed verbatim in §5 and are **not**
  claimed as verified.

## 1. Release artifact (validated)

| Field | Value |
|-------|-------|
| Installer | `DentivaPro-Setup-4.1.2.exe` (NSIS, per-user, selectable directory) |
| Size | 100,050,198 bytes (≈95.4 MiB) |
| SHA-256 (runner-computed) | `d60ee6af4bb2f48059d6c8157d13eab6c6070fc7075b5b1d1f59550050e5c2a3` |
| Checksum file | `SHA256SUMS.txt` (94 bytes) — content is exactly `d60ee6af…e5c2a3  DentivaPro-Setup-4.1.2.exe` |
| Release assets | installer + `SHA256SUMS.txt`, both `uploaded` and non-draft |
| Built by | GitHub Actions `windows-latest`, tag run [38542113518](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38542113518) on `b86a1a3` |
| Hash triangulation | runner notice `installer SHA-256` == GitHub release-asset digest `sha256:d60ee6af…e5c2a3`; the published checksum file's own asset digest (`sha256:3fd8cb23…`) equals the SHA-256 of the reconstructed checksum line, so the published checksum describes the published installer |
| Tested as artifact | **Yes** — the same CI job silently installed the produced `.exe` (`/S /D=…`), launched the installed application, drove it through the packaged activation → first-run setup (real packaged Argon2id + SQLite) → sign-in path, then silently uninstalled. The job that proved this is the job that built the released file. |
| Publish gate | Tag name == `package.json` version (4.1.2), tag SHA == verified `GITHUB_SHA`, tag ancestor of `main`, `docs/RELEASE_NOTES_4.1.2.md` present, checksum file matches the installer, existing release refused rather than overwritten |

## 2. Quality gates (evidence)

| # | Gate | Evidence | Result |
|---|------|----------|--------|
| 1 | Main-process typecheck | `tsc -p tsconfig.node.json --noEmit` (local, Linux) | ✅ exit 0 |
| 2 | Renderer + tests typecheck | `tsc -p tsconfig.renderer.json --noEmit` (local) and the `verify` job on `windows-latest` | ✅ exit 0 |
| 3 | Lint | `eslint .` — local and CI | ✅ 0 errors |
| 4 | Unit + integration | `vitest run` — **43 files / 472 tests** (local, Linux); the same suite runs in the Windows `verify` job | ✅ all passed |
| 5 | Design-preservation guard | `tests/unit/document-layout.test.ts` renders all 7 printable documents and compares them byte-for-byte with `tests/fixtures/legacy-print-documents.tsx` (dates/times normalized); empty stylesheet when nothing is customized | ✅ identical |
| 6 | Feature A behaviour | `tests/unit/document-styles.test.ts`, `tests/integration/document-customization.test.ts` (round-trip through settings, bounds clamping, scoped resets, no interference with clinic/prescription/print/WhatsApp settings) | ✅ passed |
| 7 | Feature B behaviour | `tests/unit/quick-documents.test.ts`, `tests/integration/document-customization.test.ts` — record counts for patients/invoices/prescriptions/payments/visits/appointments identical before and after preparing all five document kinds; source-level guard asserts no WhatsApp surface in the walk-in workflow | ✅ passed |
| 8 | Form/label accessibility | `tests/unit/document-forms-a11y.test.ts` asserts every `for="…"` label resolves to an `id="…"` control on the real walk-in and customizer components | ✅ passed (this is the regression test for AUD-412-08) |
| 9 | Production build | `npm run build` — local and CI | ✅ clean |
| 10 | Dependency audit | `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| 11 | Electron E2E (Windows) | Playwright against the real application: existing patient/print/PDF/WhatsApp/settings flows plus the new walk-in screen and its print window — tag run [38542113518](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38542113518) | ✅ passed |
| 12 | NSIS installer build | Same run, `package` job: `npm run dist` produced `dist/DentivaPro-Setup-4.1.2.exe` | ✅ |
| 13 | Installed-artifact smoke | Silent install → packaged-app activation/setup/sign-in → silent uninstall, in the same job | ✅ |
| 14 | Checksums published | `dist/SHA256SUMS.txt` generated, verified against the installer inside the job, attached to the release | ✅ |
| 15 | Release publication | `gh release create v4.1.2 … --verify-tag` plus a post-create `gh release view` asset check inside the workflow | ✅ |

Earlier runs on the same code: push `38540067953`, pull requests `38540068591` and `38541183501` — all
three green in every job. The first attempt (`d1965d8`) failed the Windows E2E job and is documented as
AUD-412-08 in `docs/AUDIT_V4.1.2.md`.

## 3. What shipped

- **Settings → Customize Documents** — per-element styling (colour, font size/weight/family, alignment,
  line height, margin/padding, borders, visibility, logo size/alignment) for every printable document
  type, addressed by stable element ids, with a live preview rendered by the real print renderer, scoped
  resets (element / section / document / all), persistence through the existing settings architecture and
  validated fallbacks for invalid values.
- **Walk-in / Quick Documents** — all applicable printable documents for one-time customers without
  registering a permanent patient, reusing the existing forms, validation, calculation and renderer code
  through a transient typed context. Nothing is written to the patient, invoice, prescription, payment,
  visit or appointment tables; drafts live in an in-memory store (TTL 2 h, cap 24) and only an audit row
  is recorded. There is no WhatsApp surface anywhere in that workflow, and WhatsApp elsewhere is
  untouched.
- **Design preservation** — defaults reproduce the 4.1.1 layouts exactly; customization is opt-in per
  element and "original design + validated overrides = final document".

User-facing detail: `docs/RELEASE_NOTES_4.1.2.md`. Printing/customization reference: `docs/PRINTING.md`.
Audit findings: `docs/AUDIT_V4.1.2.md`.

## 4. Defects found and fixed during the release

| Id | Severity | Found by | Fix |
|----|----------|----------|-----|
| AUD-412-01 … 07 | low/medium | repository audit (see `docs/AUDIT_V4.1.2.md`) | fixed, each with a regression test |
| AUD-412-08 | medium | Windows Electron E2E job of `d1965d8` (`locator.fill: Timeout 30000ms exceeded` in the walk-in test) | quick-document form fields were rendered as `{() => …}`, ignoring the id the `Field` primitive generates, so no label was associated with any control; all 28 field render functions now use `{(id) => <Control id={id} …/>}` and the customizer labels carry matching ids. Locked by `tests/unit/document-forms-a11y.test.ts`, then re-verified by the Windows pipeline on `b86a1a3`. |

## 5. Not verified in this environment (explicit gaps)

These were **not** executed and must not be read as passed:

1. **Physical print output** — no printer, no paper path. Print-window rendering, DPI/scale behaviour on a
   real device and tonal accuracy of colours are unverified; only the generated markup/layout is tested.
2. **Bengali glyph shaping in the print window** on a physical device (the renderer uses system fonts).
3. **Interactive manual walk-through on Windows** beyond the automated Playwright journey: a human has not
   clicked through the customizer or the walk-in screen on a Windows desktop in this session.
4. **Re-downloading the release assets from this sandbox** — the release-asset CDN refuses connections from
   this environment, so the installer was not checksummed here; the runner-computed hash and GitHub's own
   asset digest agree, which is the strongest evidence available without the download.
5. **Installer UX details** (upgrade over an existing 4.1.1 install, custom install directory, uninstall
   from Control Panel) — the automated smoke test installs silently and uninstalls silently.

Everything in §1–§4 above was executed and observed; nothing in this report is a prediction.

## 6. Verified links

- Pull request: https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/pull/28
- Tag run (build + publish): https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38542113518
- Branch run: https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38540067953
- PR runs: https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38540068591 · https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/38541183501
- Release: https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v4.1.2
