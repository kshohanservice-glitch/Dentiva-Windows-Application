# Dentiva Pro — Backup & Restore

## Backup container

File: `DentivaPro_Backup_YYYY-MM-DD_HH-mm-ss.dpv` (`.dpv` = ZIP) containing:

```
manifest.json   # format: "dentiva-backup", formatVersion, appVersion, schemaVersion,
                # createdAt, kind (manual|auto|pre_restore), dbSha256, counts{...}
database/dentiva.db         # consistent snapshot via better-sqlite3 db.backup() (online, safe)
attachments/                 # copy of application-managed attachment tree
```

- Timestamped names; **never overwrite** an existing backup (suffix `-2`, `-3`… if collision).
- Success recorded only after: snapshot finished + zip closed + checksum computed.
  Result written to `backups` table and notification center (failure → red alert, never silent).

## Manual backup

Settings → Backup → choose destination folder (native dialog) → progress → result dialog
showing path, size, elapsed; failure shows the real OS error.

## Automatic backup

Setting: frequency 7 / 15 / 30 days (or off), destination folder, retention count
(default keep last 10). Checked at app startup and daily: if due → runs in background,
records success/failure; failures raise persistent notification.

## Restore

1. Select `.dpv` file.
2. **Validate**: zip readable → manifest present & formatVersion supported → schemaVersion
   ≤ current (reject newer schema) → reject traversal, duplicate paths, symlinks,
   unexpected entries and oversized archive entries → extract to temp → db file present →
   `PRAGMA integrity_check` on extracted DB (fail ⇒ abort, current DB untouched) →
   `dbSha256` matches manifest.
3. **Pre-restore backup** of the *current* state (kind=pre_restore) — mandatory; if it
   fails ⇒ abort restore.
4. Confirmation dialog with typed confirmation (`RESTORE`) + data-loss warning.
5. Stage database and attachments, then close and replace active files with rollback
   copies retained until reopen, pending migrations and integrity re-check succeed.
   The database and directory swap is **not** a single atomic filesystem operation.
6. On swap/reopen failure: restore previous DB and attachment directory; if rollback
   itself fails, surface a manual-recovery error and preserve rollback artifacts.
7. App prompts restart-safe reload; audit records start/finish/failure of restore.

Multiple backups: restore applies one selected snapshot (full replace); the pre-restore
copy allows undoing the restore itself.

## Failure matrix (test coverage in this branch; Windows/device checks still pending)

| Scenario | Behavior |
|---|---|
| Destination missing / read-only / full / locked | Error surfaced; no "success" claimed; partial files cleaned |
| Backup interrupted | Temp file discarded; DB untouched; failure recorded |
| Corrupt/incomplete/wrong zip | Validation aborts before any swap |
| Corrupt DB inside backup | integrity_check fails ⇒ abort, original intact |
| Interrupted restore | Rollback from pre-restore backup; explicit report |
| Schema too new | Refused with message |

## Operational caution

Do not attempt a restore on the clinic's only copy. Verify the backup exists, copy
it off-device, and rehearse on scratch data first. Existing v3.0.3 backups may
contain Queue records; migration retains them as historical rows after restore.
The staged safety tests cover tampered archive paths, hashes, missing attachment
files and forced mid-swap rollback. Disk exhaustion, antivirus locks, crash/power
loss and Windows recovery still need platform/device validation before release.
