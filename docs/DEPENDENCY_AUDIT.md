# Dentiva Pro — Dependency & License Audit

_Status: living document. Finalized at feature freeze; release gate requires this to be
complete with `npm audit --omit=dev` clean._

## Criteria for shipping
1. Permissive license compatible with commercial closed-source distribution (MIT/ISC/Apache-2.0/BSD/CC0/OFL).
2. No network calls at runtime (offline requirement).
3. No paid API/service dependency.
4. No known high/critical vulnerability in shipped code path.
5. Actively maintained or trivially replaceable.

## Production dependencies (planned inventory — finalized after implementation freeze)

| Package | License | Purpose | Runtime net? | Notes |
|---|---|---|---|---|
| electron | MIT | desktop shell | no | devDependency (packaged runtime by builder) |
| react / react-dom | MIT | UI | no | |
| better-sqlite3 | MIT | embedded DB | no | native, rebuilt for Electron |
| @node-rs/argon2 | MIT | password hashing | no | N-API prebuild |
| archiver | MIT | backup zip writing | no | |
| unzipper | MIT | backup zip reading | no | |
| react-router-dom | MIT | routing | no | |
| vite, typescript, eslint, vitest, playwright, electron-builder … | MIT/APACHE | build/test only | n/a | devDependencies — not shipped |

Rejected dependencies: chart libs (CSS-only charts suffice), UI kits (design system is
hand-authored → fewer license/surface risks), moment/dayjs (native Intl sufficient),
electron-updater (offline product — no auto-update channel by design).

## Third-party notices
See `THIRD_PARTY_NOTICES.md` (generated at freeze) — includes bundled fonts (OFL):
Inter, Noto Sans Bengali, Noto Sans.
