# Dentiva Pro 4.1.1 — WhatsApp opening reliability

Offline Windows x64 dental-clinic application. This is a **patch release** on top of 4.1.0. It upgrades an existing 4.1.0 (or earlier) database in place with **no schema change** — migration history is unchanged (schema 6) and no patient data is rewritten. Every earlier release, including 4.0.0 and 4.1.0 and their installers, remains untouched.

## Why this release exists

A clinic reported that pressing the WhatsApp action in 4.1.0 displayed:

> **Could not open WhatsApp** — An unexpected error occurred. Please try again.

on a computer **without WhatsApp Desktop installed**. The audit proved that WhatsApp Desktop was never required — Dentiva Pro hands the operating system a normal `https://wa.me/<number>?text=…` link, which opens in the default browser — but that when Windows refused the hand-off (typically because no default browser / `https` handler is registered for web links) the real reason stayed in the application log and the doctor saw only a generic internal error. Two further defects were found in the same path and fixed here.

## Fixes

### 1. The real reason is now shown, with a way forward

- `whatsapp/open` no longer lets a refused shell hand-off collapse into “An unexpected error occurred”. The doctor is told, in English, to check that a default browser is set for web links (Windows Settings → Apps → Default apps) or to use **Copy link** — while the raw system text is kept in the log for support, next to a correlation id. No internal error text or file path reaches the UI.
- A new **Copy link** action (Patient Profile → *WhatsApp & Documents*, the message composer, and the Share PDF dialog) puts the same strictly validated `wa.me` link on the clipboard so it can be pasted into a browser or WhatsApp when Windows cannot open it.
- **Copy link never claims success it cannot back up.** A failed clipboard write is reported as an actionable failure, and the clipboard is read back (best effort) so a write that Windows silently dropped — showing the *previous* clipboard contents — is treated as a failure instead of “Link copied”. When the clipboard cannot be read back at all, the copy cannot be confirmed; Dentiva Pro makes no verification claim in that case (see *Known limitations*).

### 2. A message Dentiva Pro prepares can no longer be refused by Dentiva Pro

- The 4,000-character message limit is now enforced **once, after the final message is rendered**, so it covers every path: text the doctor edited by hand, a template rendered with real patient data, and the Share-PDF introduction. Previously only hand-edited text was checked, and a long custom body combined with a long template could render a message whose link neither *Open* nor *Copy link* would accept.
- The custom message body is bounded as an input as well, so an oversized body is refused with a clear validation error — naming the field — **before** any link is created.
- The link ceiling, the template-body cap, the custom-body cap and the composer textareas all use one shared constant each (`MAX_WHATSAPP_MESSAGE_LENGTH`, `MAX_WHATSAPP_LINK_LENGTH`), so the limits can no longer drift apart.

### 3. Malformed text can no longer produce a generic error

- Pasting text that contains an unpaired Unicode surrogate used to make URL encoding throw `URIError: URI malformed`, which surfaced as the same generic message. Such characters are now replaced with `U+FFFD`, and the doctor is warned that the prepared text was repaired.
- Valid multilingual text is copied **byte for byte** — Bengali (including conjuncts and vowel signs), Devanagari, Arabic, ZWJ emoji sequences and combining marks are never altered. Tests cover both valid multilingual text and deliberately malformed input.

## Changes

| Area | Change |
| --- | --- |
| `src/shared/whatsapp.ts` | Shared message/link length constants; `sanitizeUnpairedSurrogates()` used before URL encoding. |
| `src/main/services/whatsapp.ts` | Single post-render length check for every preparation path; bounded custom body; repair warning; template-body cap uses the shared constant. |
| `src/main/ipc/router.ts` | Actionable, logged failure for a refused `shell.openExternal()`; new `whatsapp/copy-link` with permission check, strict URL validation, write-failure detection and best-effort read-back. |
| `src/shared/ipc.ts` | Declares the `whatsapp/copy-link` channel and bridge method. |
| `src/renderer/…` | `Copy link` buttons and a short note that WhatsApp Desktop is not required; `maxLength` on the WhatsApp textareas via the shared `Textarea`. |

Unchanged on purpose: permission checks (`patients.view`), patient-consent rules, the strict `https://wa.me/<digits>` URL validation, context isolation/sandbox, the absence of any automatic sending, and the absence of any paid, cloud or WhatsApp Business API dependency. **No database migration was added or modified.**

## Installation and upgrade

1. **Before upgrading:** in your current version, make a manual `.dpv` backup (Backup page), copy it to separate storage and confirm it is readable. Keep the existing installer of the version you are running.
2. Download `DentivaPro-Setup-4.1.1.exe` and `SHA256SUMS.txt` from this release. Verify the installer checksum before running it (PowerShell: `Get-FileHash .\DentivaPro-Setup-4.1.1.exe -Algorithm SHA256`) and compare it with the checksum file.
3. Close Dentiva Pro, run the installer as the intended Windows user, sign in and confirm your existing patients, appointments, invoices and WhatsApp message history are present.
4. If anything looks wrong, stop using the updated app and preserve both the backup and the data directory for investigation. Downgrading an upgraded database into 4.0.0 or earlier is **not supported**.

Upgrading from 4.0.0 skips nothing: 4.1.1 contains the 4.1.0 WhatsApp messaging and PDF-sharing features plus these fixes.

## Compatibility and known limitations

- Windows x64 NSIS installer; per-user install, configurable location, Start Menu/desktop shortcuts, clinic data preserved on uninstall.
- WhatsApp is reached through the operating system's handling of web links (default browser → WhatsApp Web, or WhatsApp Desktop if installed). Dentiva Pro does not check whether a number has a WhatsApp account and cannot provide delivery or read receipts — the doctor presses **Send** in WhatsApp.
- **Clipboard verification is best effort.** When Windows does not allow the clipboard to be read back, a copy cannot be confirmed; this is documented rather than claimed.
- **Not verified in this release environment** (no Windows desktop available to the build sandbox): the real browser hand-off on a machine without WhatsApp Desktop, the behaviour when no default browser is configured, and real clipboard behaviour on Windows (including a locked clipboard). Automated Windows CI does verify that the installer installs silently and the installed application starts to the sign-in screen.

## Tests and gates

- 37 test files / 375 unit and integration tests pass, including new coverage for: a failed clipboard write, a silently dropped write detected by read-back, an unavailable read-back, the message limit at the boundary (4,000 accepted, 4,001 refused) on the rendered, custom-body and edited paths, an over-long Share-PDF introduction refused before anything is prepared, malformed-Unicode repair, and byte-for-byte preservation of valid multilingual text.
- TypeScript checks (main process and renderer/tests), ESLint, the production build and `npm audit --omit=dev --audit-level=moderate` are clean.
- The tag pipeline rebuilds the NSIS installer from the tagged commit, checks the native Argon2 binding, silently installs the produced `.exe`, smoke-tests the installed application, recomputes the installer SHA-256 against `SHA256SUMS.txt`, and only then publishes this release. A failed verification stops publication.

## Release protection

`v4.0.0` and `v4.1.0` and every earlier release, tag and asset were left untouched by this release: no asset was replaced, re-uploaded or deleted, and no tag was moved.
