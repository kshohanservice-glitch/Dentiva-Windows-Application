# Dentiva Pro 4.1.0 — Free WhatsApp Messaging & PDF Sharing

Offline Windows x64 dental-clinic application. This release adds free, manual WhatsApp messaging and patient-document sharing on top of 4.0.0. It upgrades the 4.0.0 database in place; it does not replace clinic data, and every earlier release remains untouched.

## Highlights

1. **Completely free WhatsApp messaging with no paid API.** Dentiva Pro prepares a message and opens the official WhatsApp Click to Chat link (`https://wa.me/...`). There is no WhatsApp Business Cloud API, no Twilio or other provider, no AI/translation API, no cloud server, scheduler, token or secret. The doctor reviews the message, attaches any PDF by hand, and presses Send inside WhatsApp.
2. **Bengali patient messages, English software.** Every tab, button, label and dialog stays in English. Only the patient-facing message content is Bengali, starting with a time-based greeting (শুভ সকাল / শুভ দুপুর / শুভ বিকেল / শুভ সন্ধ্যা / শুভ রাত্রি) chosen from the clinic-local time when the message is prepared — never from the appointment time, and with no religious salutation.
3. **The Patient Profile is the document hub.** A new "WhatsApp & Documents" tab lists every printable document that already exists for that patient — prescriptions, invoices, payment receipts, visit summaries and appointment cards — with preview (the existing Print flow) and PDF sharing preparation.

## Changes

### WhatsApp numbers and consent

- A dedicated **WhatsApp Number** field sits next to the existing Phone Number in Patient Registration and Edit Patient, with a **Same as Phone Number** checkbox and a **Validate Number** action. The clinic phone number keeps its existing format and is never rewritten.
- Bangladesh local numbers (`017...`, `+880...`, `880...`, duplicated country codes) and valid international numbers are normalized to the digits-only international form Click to Chat requires. Invalid numbers are rejected with an English explanation; the field is optional and old patients simply have no WhatsApp number until one is recorded.
- WhatsApp consent is recorded per patient (Not recorded / Granted / Declined). A phone number is not treated as consent: unrecorded consent warns, declined consent blocks preparation, and existing patients are never opted in automatically.

### Bengali message templates

- Local, editable templates for Appointment Reminder, Follow-up Reminder, Appointment Confirmation, Rescheduling, Cancellation, PDF Introduction and a General Custom Message — stored in the clinic database (migration 006), editable in **Settings → Message Templates**, with create, duplicate, enable/disable, restore-default and delete for custom templates. Administrator edits survive upgrades; restoring a default never touches custom templates.
- Placeholders fill patient, clinic, dentist, appointment, follow-up and document data from the real database records. Missing information is reported in English and left out — never rendered as `undefined`, `null` or an unresolved placeholder, and no date, name or amount is ever fabricated.
- Greeting time ranges and the clinic time zone (IANA name, defaulting to the computer's zone) are configurable in Settings. If the zone cannot be resolved, the app falls back to device-local time and tells the doctor.

### Patient documents and PDF sharing

- The document list is rebuilt from live patient records on every view and checked against the selected patient ID and the user's existing permissions, so one patient's documents can never appear on another's profile.
- Sharing prepares a Bengali introduction message, an organized share folder in the app's temporary area with a `SHARE-MANIFEST.txt`, and the suggested PDF file names. PDFs are produced by the existing Print Preview → Save PDF flow with the real recorded amounts. Click to Chat cannot attach files, so the doctor attaches the PDFs manually in WhatsApp; Dentiva Pro never claims a file was attached or a message delivered.
- Temporary share folders are removed automatically after 24 hours. Original clinic documents are never modified or deleted by cleanup.

### Safety and honesty

- Opening a WhatsApp link is never presented as delivery: message history records preparation and only the doctor's own reported outcome (Sent / Not Sent / Unknown), labelled as self-reported.
- The main process only opens strictly validated `https://wa.me/<digits>` URLs through the operating system — no unofficial endpoints, automation, scraping or Send-button clicking, and no public URLs to patient documents.
- No automatic or scheduled sending was added; every message is prepared and sent manually.

### Data

- Migration 006 is additive: new patient columns default to empty/`unknown`, new `whatsapp_templates` and `whatsapp_message_log` tables are added, and default templates are seeded without overwriting existing edits. Backups (`.dpv`) carry the new data automatically and older backups restore and then migrate as before.

### Tests and gates

- 355 unit/integration tests pass locally (308 in 4.0.0), including new suites for number normalization, greeting boundaries and time zones, template rendering, Click to Chat URL safety, migration from a v3.0.3 database, patient-document isolation, consent handling and the English-UI gate. Typecheck, ESLint, production build and `npm audit --omit=dev` are green. Windows CI additionally builds the NSIS installer, silently installs it and smoke-tests the installed application before any release is published.

## Installation and upgrade

1. **Before upgrading:** in 4.0.0 make a manual `.dpv` backup (Backup page), copy it to separate storage, and confirm it is readable. Keep the prior installer. Do not test restore on the clinic's only data copy.
2. Download `DentivaPro-Setup-4.1.0.exe` and `SHA256SUMS.txt` from this release. Verify the installer SHA-256 against the checksum file before running it (Windows PowerShell: `Get-FileHash .\DentivaPro-Setup-4.1.0.exe -Algorithm SHA256`).
3. Close Dentiva Pro, run the installer as the intended Windows user, sign in, and verify patient counts, WhatsApp numbers, a prepared reminder, and a document preview on the clinic's own equipment.
4. If migration or validation fails, stop using the updated app and preserve the backup and data directory for investigation. Downgrading an upgraded database into 4.0.0 or earlier is **not supported**.

## Compatibility and known limitations

- Windows x64 NSIS installer; native SQLite and Argon2 bindings are built and smoke-tested by Windows CI, which also silently installs the produced installer and runs the installed application.
- WhatsApp must be available through the operating system's handling of `wa.me` links (WhatsApp Desktop or a browser). Dentiva Pro does not check whether a number has a WhatsApp account and cannot provide delivery or read receipts.
- PDFs are saved by the doctor from the existing Print Preview and attached manually; prepare one document at a time in the preview when sharing several.
- **Not verified in this release environment:** physical printer output, real WhatsApp Desktop routing on a clinic PC, DPI/layout at 100–200% scaling, and assistive-technology review.
