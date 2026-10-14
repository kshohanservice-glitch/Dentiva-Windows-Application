# WhatsApp opening failure — audit, root cause and fix (v4.1.0 code, unreleased fix)

Status: **investigation complete; fix implemented on the Arena session branch and
covered by tests. Not released, no installer built or uploaded.**
Date: 2026-10-14. Environment: Linux sandbox (no Windows, no Electron binary
download — see "Windows checks" below).

## Reported symptom (Dentiva Pro 4.1.0, `DentivaPro-Setup-4.1.0.exe`)

Clicking the WhatsApp action showed:

- Title: `Could not open WhatsApp`
- Message: `An unexpected error occurred. Please try again.`

WhatsApp Desktop was **not** installed on the affected computer.

## What the code actually does (verified)

| Step | Code | Verified how |
| --- | --- | --- |
| Build link | `buildWhatsAppUrl()` in `src/shared/whatsapp.ts` → `https://wa.me/<digits>?text=<percent-encoded message>` | existing unit tests + direct execution |
| Validate number | `normalizeWhatsAppNumber()` / `assertDestination()` in `src/main/services/whatsapp.ts` | existing integration tests |
| Prepare message | `prepareWhatsAppMessage()` (consent, ownership, placeholders) | existing integration tests |
| IPC | `whatsapp/prepare` and `whatsapp/open` in `src/main/ipc/router.ts`, preload allowlist in `src/preload/index.ts` | new `tests/integration/whatsapp-open-ipc.test.ts` |
| Open | `shell.openExternal(url)` after `assertSafeWhatsAppOpenUrl()` | new `tests/integration/whatsapp-open-ipc.test.ts` |
| Show error | `toWireError()` in `src/main/errors.ts` + `toast.fromError()` in `src/renderer/components/primitives.tsx` | new test asserts the user-facing text |

Evidence that the hand-off itself is correct: with Electron mocked, the main
process handed the operating system exactly
`https://wa.me/8801712345678?text=…` and returned `{ ok: true }`. No code path
uses `whatsapp://` or any other scheme, checks for WhatsApp Desktop, or opens
anything except a strictly validated `https://wa.me/<digits>` link
(`https`, host exactly `wa.me`, no credentials, digits-only path).

**Therefore WhatsApp Desktop is not required, and never was:** the link is an
ordinary HTTPS URL, so Windows opens it with the registered `https` handler —
the default browser, which shows WhatsApp Web.

## Root cause of the reported message

`toWireError()` maps every error that is **not** an `AppError` to the fixed text
`An unexpected error occurred. Please try again.` (`src/main/errors.ts`), and the
renderer's `toast.fromError(err, 'Could not open WhatsApp')` prints it verbatim.
So the reported pair of strings is produced by exactly one situation in this
flow: a raw (non-`AppError`) failure escaping the `whatsapp/open` handler.

On that path, with a link the app itself prepared, the only possible raw failure
is the rejection of `shell.openExternal()`. Electron implements that on Windows
with `ShellExecuteEx` (`shell/common/platform_util_win.cc`,
`SEE_MASK_FLAG_NO_UI`), and rejects with `Failed to open: <system error text>`
when Windows refuses the hand-off — for example when **no default browser (no
`https:` handler) is registered**, or the URL association is broken. The raw OS
text was written only to the application log
(`logger.error('[whatsapp/open] …', { detail })` next to a correlation id), so
the doctor saw nothing actionable — neither the real reason nor a way forward.

Proven: the failure surfaces as a rejection of `shell.openExternal()`, and that
rejection is what produced the exact generic message (new test).
Not proven here: *why* the affected Windows machine refused the hand-off —
`ShellExecuteEx` needs a live Windows desktop with the clinic's URL
associations, which this environment cannot provide. The candidates, in order of
likelihood, are (a) no default browser/`https` handler configured on that
machine, and (b) a URL that is too long for the shell hand-off: the default
Bengali appointment reminder already produces a link of ≈2.3 kB with realistic
clinic data, which is close to the practical `ShellExecute` URL ceiling. Both are
host-side conditions, not a missing WhatsApp Desktop.

## Genuine defect found in the app's own validation (fixed)

`assertSafeWhatsAppOpenUrl()` capped the link at 8000 characters while the
composer accepts messages of up to 4000 characters. Percent-encoding makes every
Bengali letter cost nine characters (`%XX%XX%XX`), so an edited message of
roughly 885 Bengali characters built a link the app then refused to open —
`WhatsApp link is too long (max 8000 characters)`. A link Dentiva Pro prepares
must never be rejected by Dentiva Pro.

## Smallest safe fix

| File | Change |
| --- | --- |
| `src/shared/whatsapp.ts` | Added `MAX_WHATSAPP_MESSAGE_LENGTH` (4000) and `MAX_WHATSAPP_LINK_LENGTH` (derived: prefix + worst-case percent-encoding), so the message limit and the open guard can no longer disagree. |
| `src/main/services/whatsapp.ts` | Uses both constants (message-length check and open-guard cap). URL shape validation is unchanged. |
| `src/main/ipc/router.ts` | `whatsapp/open` wraps `shell.openExternal()`: the raw OS reason is logged, and the doctor receives an English, actionable message naming the default-browser check and the `Copy link` recovery. Added `whatsapp/copy-link`, which writes only a validated `wa.me` link to the clipboard (same permission check and same validator as `whatsapp/open`). |
| `src/shared/ipc.ts` | Declares the new `whatsapp/copy-link` channel and bridge method (the preload forwards every allowlisted channel automatically). |
| `src/renderer/components/whatsapp-hub.tsx` | `Copy link` buttons (Patient Profile hub, message composer, Share PDF dialog) and a short explanation that WhatsApp Desktop is not required. |

Unchanged on purpose: permission checks (`patients.view`), patient-consent rules,
URL safety validation, context isolation/sandbox, the absence of any automatic
sending, and the absence of any paid or cloud messaging dependency.

## Tests actually run (Linux sandbox, 2026-10-14)

| Command | Result |
| --- | --- |
| `npx vitest run tests/integration/whatsapp-open-ipc.test.ts` | 9 passed (new file) |
| `npm test` (full suite) | **37 files / 365 tests passed** (was 36 / 355 before this change) |
| `npx tsc -p tsconfig.node.json --noEmit` | pass |
| `npx tsc -p tsconfig.renderer.json --noEmit` | pass |
| `npx eslint .` | pass, 0 errors |
| `npm run build` (main + renderer) | pass |

The new tests cover: the exact URL handed to the OS, an OS refusal mapped to an
actionable message (and never to the generic internal text, with no `ShellExecute`
/ `Failed to open` detail leaked), rejection of `javascript:`, `http:`, foreign
hosts, `file:`, `whatsapp://` and non-string payloads without calling
`shell.openExternal`, the longest Bengali message the app can build, the
permission check, and the clipboard recovery path (validated link only).

## Windows checks — completed vs. pending

Completed here: everything above, which is code-level evidence only.

**Pending (needs a Windows desktop, cannot be claimed as verified):**

1. Install `DentivaPro-Setup-4.1.0.exe` on a Windows machine **without**
   WhatsApp Desktop and with a default browser set, then press a WhatsApp
   action: the browser should open `https://wa.me/<number>?text=…` and show
   WhatsApp Web.
2. Same machine with **no** default browser (or a removed browser): expect the
   new message (default-browser check plus `Copy link`), and `Failed to open: …`
   in `%APPDATA%\dentiva-pro\logs\app-<date>.log`.
3. `Copy link` on Windows, pasted into a browser and into WhatsApp — confirms the
   clipboard recovery path (the clipboard write itself is not exercised by the
   Linux test, which mocks Electron's `clipboard`).
4. The Windows CI jobs (`verify`, Electron E2E, NSIS installer + installed-app
   smoke test) for this branch.

## Release impact

- The fix changes packaged application code, so clinics can only receive it
  through a **new installer**. No installer was built, uploaded or published
  here, and no release was created or modified: `package.json` intentionally
  stays at `4.1.0`.
- A future patch release (for example `4.1.1`) needs its own
  `docs/RELEASE_NOTES_4.1.1.md` and the existing CI gates before publication,
  and only after explicit authorisation.
- v4.0.0 and every existing release (including the v4.1.0 assets and tag) were
  left untouched: the v4.1.0 tag still points at
  `65d24d04a63681a455d79c50141adcb31596183f`, and its assets
  (`DentivaPro-Setup-4.1.0.exe`, `SHA256SUMS.txt`) were not replaced, re-uploaded
  or deleted.
