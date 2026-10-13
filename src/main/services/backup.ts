import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import unzipper from 'unzipper';
import type { DB } from '../db/database';
import { fullIntegrityCheck, openDatabase, schemaVersionOf } from '../db/database';
import type { BackupRecordDTO } from '../../shared/ipc';
import { AppError, validation } from '../errors';
import { audit, requirePermission, type Ctx, type PlainCtx } from '../core/context';
import type { AppPaths } from '../paths';
import { ensureDir } from '../paths';
import {
  ARCHIVE_LIMITS,
  ArchiveRejectedError,
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  byteLimiter,
  planArchive,
  resolveInside,
  validateRelativePath,
  type ArchivePlan,
} from './archive-safety';

type OpenZip = Awaited<ReturnType<typeof unzipper.Open.file>>;
import { nowISO } from '../../shared/currency';

export interface DbHolder {
  get(): DB;
  set(db: DB): void;
}

export interface BackupDeps {
  paths: AppPaths;
  holder: DbHolder;
  appVersion: string;
  notify: (n: { key: string; kind: string; severity: 'info' | 'warning' | 'danger' | 'success'; title: string; body: string; entityType?: string; entityId?: string }) => void;
}

const FORMAT = 'dentiva-backup';
/** Tables every restorable database must contain (see migrations/001_init.ts). */
const REQUIRED_TABLES = ['users', 'roles', 'patients', 'appointments', 'invoices', 'payments', 'attachments', 'settings', 'backups'];
const FORMAT_VERSION = 1;

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function zipDirectory(attachmentsDir: string, outFile: string, manifest: Buffer, dbStagedPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(dbStagedPath, { name: 'database/dentiva.db' });
    archive.append(manifest, { name: 'manifest.json' });
    if (fs.existsSync(attachmentsDir)) archive.directory(attachmentsDir, 'attachments');
    void archive.finalize();
  });
}

function uniquePath(dir: string, base: string, ext: string): string {
  let candidate = path.join(dir, `${base}${ext}`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${n}${ext}`);
    n++;
  }
  return candidate;
}

export function createBackupService(deps: BackupDeps) {
  const { paths, holder } = deps;

  let restoreInProgress = false;

  function rowToDTO(r: any): BackupRecordDTO {
    return {
      id: r.id, filename: r.filename, path: r.path, createdAt: r.created_at,
      sizeBytes: r.size_bytes, schemaVersion: r.schema_version, kind: r.kind,
      status: r.status, error: r.error, checksum: r.checksum,
    };
  }

  async function runBackup(ctx: { db: DB }, destination: string, kind: 'manual' | 'auto' | 'pre_restore' = 'manual'): Promise<BackupRecordDTO> {
    if (!destination || typeof destination !== 'string') throw validation('Backup destination folder is required.');
    try {
      ensureDir(destination);
      fs.accessSync(destination, fs.constants.W_OK);
    } catch (e: any) {
      throw new AppError('BACKUP', `Backup destination is not writable: ${e?.message ?? destination}`);
    }

    const db = holder.get();
    const dbInfo = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM patients) patients,
                (SELECT COUNT(*) FROM visits) visits,
                (SELECT COUNT(*) FROM invoices) invoices`,
      )
      .get() as { patients: number; visits: number; invoices: number };

    const filename = `DentivaPro_Backup_${stamp()}.dpv`;
    const outPath = uniquePath(destination, filename.replace(/\.dpv$/, ''), '.dpv');
    const finalName = path.basename(outPath);

    const insert = db.prepare(
      'INSERT INTO backups (filename, path, created_at, size_bytes, schema_version, kind, status, error, checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const info = insert.run(finalName, outPath, nowISO(), 0, schemaVersionOf(db), kind, 'running', null, null);
    const recordId = Number(info.lastInsertRowid);

    const staging = path.join(paths.tempDir, `backup-${Date.now()}`);
    try {
      ensureDir(path.join(staging, 'database'));
      const stagedDb = path.join(staging, 'database', 'dentiva.db');
      await db.backup(stagedDb);
      const integrity = fullIntegrityCheck(stagedDb);
      if (!integrity.ok) throw new AppError('BACKUP', `Backup snapshot failed integrity check: ${integrity.errors.join('; ')}`);
      const checksum = await sha256File(stagedDb);

      const manifest = Buffer.from(
        JSON.stringify(
          {
            format: FORMAT,
            formatVersion: FORMAT_VERSION,
            appVersion: deps.appVersion,
            schemaVersion: schemaVersionOf(db),
            createdAt: nowISO(),
            kind,
            dbSha256: checksum,
            counts: dbInfo,
          },
          null,
          2,
        ),
        'utf8',
      );

      await zipDirectory(paths.attachmentsDir, outPath, manifest, stagedDb);

      const size = fs.statSync(outPath).size;
      if (size <= 0) throw new AppError('BACKUP', 'Backup file was not written correctly.');
      db.prepare('UPDATE backups SET size_bytes = ?, status = ?, checksum = ? WHERE id = ?')
        .run(size, 'ok', checksum, recordId);
      audit(ctx, { action: 'backup.create', entityType: 'backup', entityId: recordId, summary: `Backup created: ${finalName} (${Math.round(size / 1024)} KB, kind=${kind})` });
      pruneRetention(destination, kind);
      const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(recordId) as any;
      return rowToDTO(row);
    } catch (e: any) {
      try {
        if (fs.existsSync(outPath)) fs.rmSync(outPath, { force: true });
      } catch { /* cleanup best effort */ }
      const message = e instanceof AppError ? e.userMessage : e?.message ?? 'Backup failed.';
      try {
        db.prepare('UPDATE backups SET status = ?, error = ? WHERE id = ?').run('failed', message, recordId);
      } catch { /* db may be closed */ }
      deps.notify({
        key: `backup-failed-${recordId}`, kind: 'backup', severity: 'danger',
        title: 'Backup failed', body: message, entityType: 'backup', entityId: String(recordId),
      });
      audit(ctx, { action: 'backup.create', entityType: 'backup', entityId: recordId, summary: `Backup FAILED: ${message}`, result: 'error' });
      throw new AppError('BACKUP', `Backup failed: ${message}`);
    } finally {
      try {
        fs.rmSync(staging, { recursive: true, force: true });
      } catch { /* cleanup best effort */ }
    }
  }

  function pruneRetention(destination: string, kind: string): void {
    if (kind !== 'auto') return;
    try {
      const retention = readBackupSetting().retention;
      const db = holder.get();
      const files = fs.readdirSync(destination)
        .filter((f) => f.startsWith('DentivaPro_Backup_') && f.endsWith('.dpv'))
        .sort()
        .reverse();
      for (const f of files.slice(retention)) {
        const full = path.join(destination, f);
        fs.rmSync(full, { force: true });
        // Keep the backup list truthful: drop rows for pruned files.
        db.prepare("DELETE FROM backups WHERE filename = ? AND kind = 'auto' AND status = 'ok'").run(f);
      }
    } catch { /* best effort */ }
  }

  function readBackupSetting(): { autoFrequencyDays: number; destination: string | null; retention: number } {
    const row = holder.get().prepare("SELECT value_json FROM settings WHERE key = 'backup'").get<{ value_json: string }>();
    try {
      return row ? JSON.parse(row.value_json) : { autoFrequencyDays: 7, destination: null, retention: 10 };
    } catch {
      return { autoFrequencyDays: 7, destination: null, retention: 10 };
    }
  }

  function listBackups(ctx: Ctx): BackupRecordDTO[] {
    requirePermission(ctx, 'backup.create');
    const rows = holder.get().prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 200').all() as any[];
    // Surface files that vanished from disk (manual deletes, disk cleanup)
    // instead of listing them as restorable.
    return rows.map((r) => {
      const dto = rowToDTO(r);
      if (dto.status === 'ok' && !fs.existsSync(dto.path)) return { ...dto, status: 'missing', error: 'File no longer exists on disk.' };
      return dto;
    });
  }

  async function restoreBackup(ctx: Ctx, filePath: string, typedConfirm: string): Promise<{ ok: true; restoredAt: string }> {
    requirePermission(ctx, 'backup.restore');
    if (typedConfirm !== 'RESTORE') throw validation('Type RESTORE to confirm restoring this backup.');
    if (restoreInProgress) throw new AppError('RESTORE', 'Another restore is already in progress.');
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new AppError('RESTORE', 'Backup file not found.');
    }
    if (fs.statSync(filePath).size > ARCHIVE_LIMITS.maxArchiveBytes) {
      throw new AppError('RESTORE', 'The backup file is larger than the supported limit.');
    }

    restoreInProgress = true;
    const staging = path.join(paths.tempDir, `restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    try {
      return await restoreFrom(ctx, filePath, staging);
    } finally {
      restoreInProgress = false;
      // Only ever remove the unique staging folder created above.
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  async function restoreFrom(ctx: Ctx, filePath: string, staging: string): Promise<{ ok: true; restoredAt: string }> {
    // 1. Open the container and validate the full entry listing before extracting anything.
    let zip: OpenZip;
    try {
      zip = await unzipper.Open.file(filePath);
    } catch {
      throw new AppError('RESTORE', 'The selected file is not a readable Dentiva Pro backup.');
    }
    if (!zip.files.some((f) => f.path === MANIFEST_ENTRY)) {
      throw new AppError('RESTORE', 'Backup is incomplete: manifest.json is missing.');
    }
    if (!zip.files.some((f) => f.path === DATABASE_ENTRY || f.path === 'database\\dentiva.db')) {
      throw new AppError('RESTORE', 'Backup is incomplete: database file is missing.');
    }
    let plan: ArchivePlan;
    try {
      plan = planArchive(zip.files.map((f) => ({
        path: f.path, type: f.type, uncompressedSize: f.uncompressedSize, compressedSize: f.compressedSize,
        externalFileAttributes: (f as any).externalFileAttributes,
      })));
    } catch (e) {
      throw new AppError('RESTORE', e instanceof ArchiveRejectedError ? e.message : 'The backup archive is not valid.');
    }
    const entryByPath = new Map(zip.files.map((f) => [f.path, f] as const));
    const manifestEntry = entryByPath.get(MANIFEST_ENTRY)!;
    const dbEntry = entryByPath.get(plan.database.info.path)!;

    // 2. Manifest: format, version and checksum policy.
    let manifest: any;
    try {
      manifest = JSON.parse((await manifestEntry.buffer()).toString('utf8'));
    } catch {
      throw new AppError('RESTORE', 'Backup manifest is corrupt.');
    }
    if (!manifest || manifest.format !== FORMAT || !Number.isInteger(manifest.formatVersion) || manifest.formatVersion > FORMAT_VERSION) {
      throw new AppError('RESTORE', 'This backup was created by an unsupported version.');
    }
    if (typeof manifest.dbSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.dbSha256)) {
      throw new AppError('RESTORE', 'Backup manifest has no valid database checksum.');
    }
    const currentSchema = schemaVersionOf(holder.get());
    if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) {
      throw new AppError('RESTORE', 'Backup manifest has no valid schema version.');
    }
    if (Number(manifest.schemaVersion) > currentSchema) {
      throw new AppError('RESTORE', 'This backup requires a newer version of Dentiva Pro.');
    }

    // 3. Extract into the private staging folder only. Live data is untouched.
    const stagedDb = path.join(staging, 'dentiva.db');
    const stagedAttachments = path.join(staging, 'attachments');
    ensureDir(staging);
    let extractedBytes = 0;
    try {
      await pipeEntry(dbEntry, stagedDb, `Database`, { checkBytes: dbEntry.uncompressedSize });
      extractedBytes += dbEntry.uncompressedSize;

      const actual = await sha256File(stagedDb);
      if (actual !== manifest.dbSha256) {
        throw new AppError('RESTORE', 'Backup checksum mismatch — the file is corrupt or was modified.');
      }

      for (const att of plan.attachments) {
        if (att.info.type === 'Directory') continue;
        const dest = resolveInside(stagedAttachments, att.relPath!);
        ensureDir(path.dirname(dest));
        const entry = entryByPath.get(att.info.path)!;
        await pipeEntry(entry, dest, `Attachment "${att.relPath}"`, { checkBytes: entry.uncompressedSize });
        extractedBytes += entry.uncompressedSize;
        if (extractedBytes > ARCHIVE_LIMITS.maxTotalUncompressedBytes) {
          throw new AppError('RESTORE', 'Backup expands beyond the supported size limit.');
        }
      }
      ensureDir(stagedAttachments);

      // 4. Validate the staged database: integrity, schema, required tables and attachment references.
      const integrity = fullIntegrityCheck(stagedDb);
      if (!integrity.ok) {
        throw new AppError('RESTORE', `Backup database failed integrity check: ${integrity.errors.join('; ')}`);
      }
      verifyStagedDatabase(stagedDb, currentSchema, stagedAttachments);
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof ArchiveRejectedError) throw new AppError('RESTORE', e.message);
      throw new AppError('RESTORE', `Backup could not be read: ${(e as Error)?.message ?? 'unknown error'}`);
    }

    // 5. Mandatory pre-restore backup of CURRENT state, then swap with rollback protection.
    const preRecord = await runBackup({ db: holder.get() }, paths.backupsDir, 'pre_restore');

    const dbFile = paths.dbFile;
    const stamp = Date.now();
    const rollbackDb = `${dbFile}.rollback-${stamp}`;
    const attachmentsDir = paths.attachmentsDir;
    const rollbackAtt = `${attachmentsDir}.rollback-${stamp}`;

    // A consistent snapshot (not a raw file copy, which can miss WAL contents).
    await holder.get().backup(rollbackDb);
    if (fs.existsSync(attachmentsDir)) fs.renameSync(attachmentsDir, rollbackAtt);

    try {
      holder.get().close();
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(dbFile + suffix)) fs.rmSync(dbFile + suffix, { force: true });
      }
      fs.copyFileSync(stagedDb, dbFile);
      if (fs.existsSync(stagedAttachments)) fs.renameSync(stagedAttachments, attachmentsDir);
      else ensureDir(attachmentsDir);

      // 5b. Reopen + verify; any failure below triggers the rollback path.
      const { db: newDb } = openDatabase(dbFile);
      holder.set(newDb);
      // Re-insert the pre-restore backup row into the restored database so it
      // remains visible in BackupHistory (the pre-swap copy of the table was
      // replaced along with everything else).
      newDb
        .prepare(
          `INSERT INTO backups (filename, path, created_at, size_bytes, schema_version, kind, status, error, checksum)
           VALUES (?, ?, ?, ?, ?, 'pre_restore', ?, NULL, ?)`,
        )
        .run(preRecord.filename, preRecord.path, preRecord.createdAt, preRecord.sizeBytes, preRecord.schemaVersion, preRecord.status, preRecord.checksum);
    } catch (swapErr: any) {
      try {
        const current = holder.get();
        if (current.open) current.close();
      } catch { /* ignore */ }
      try {
        if (fs.existsSync(dbFile)) fs.rmSync(dbFile, { force: true });
        for (const suffix of ['-wal', '-shm']) {
          if (fs.existsSync(dbFile + suffix)) fs.rmSync(dbFile + suffix, { force: true });
        }
        fs.copyFileSync(rollbackDb, dbFile);
        if (fs.existsSync(attachmentsDir)) fs.rmSync(attachmentsDir, { recursive: true, force: true });
        if (fs.existsSync(rollbackAtt)) fs.renameSync(rollbackAtt, attachmentsDir);
        holder.set(openDatabase(dbFile).db);
      } catch {
        throw new AppError('RESTORE', `Restore failed and rollback also failed: ${swapErr?.message ?? swapErr}. Manual intervention required — previous data is preserved at ${rollbackDb}.`);
      }
      throw new AppError('RESTORE', `Restore failed and was rolled back: ${swapErr?.message ?? swapErr}`);
    }

    // Success: clean rollback artifacts (only the files created above).
    try { fs.rmSync(rollbackDb, { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(rollbackAtt, { recursive: true, force: true }); } catch { /* best effort */ }

    // ctx.db still points at the pre-restore handle we just closed — audit
    // against the freshly reopened database instead.
    audit({ ...ctx, db: holder.get() }, { action: 'backup.restore', entityType: 'backup', entityId: null, summary: `Restored from ${path.basename(filePath)}` });
    deps.notify({ key: `restore-${Date.now()}`, kind: 'backup', severity: 'success', title: 'Restore completed', body: `Data was restored from ${path.basename(filePath)}.` });
    return { ok: true, restoredAt: nowISO() };
  }

  /** Stream one archive entry to disk, enforcing its declared size. */
  async function pipeEntry(entry: any, dest: string, label: string, opts: { checkBytes: number }): Promise<void> {
    const limiter = byteLimiter(opts.checkBytes, label);
    await new Promise<void>((resolve, reject) => {
      const src = entry.stream();
      const ws = fs.createWriteStream(dest, { flags: 'wx' });
      src.on('error', reject);
      ws.on('error', reject);
      limiter.stream.on('error', reject);
      ws.on('finish', () => resolve());
      src.pipe(limiter.stream).pipe(ws);
    });
    if (limiter.bytes() !== opts.checkBytes) {
      throw new ArchiveRejectedError(`${label} does not match its declared size; the backup is corrupt.`);
    }
  }

  /** Verify an extracted database BEFORE it can replace live data. */
  function verifyStagedDatabase(stagedDb: string, currentSchema: number, stagedAttachments: string): void {
    const { db, schemaVersion } = openDatabase(stagedDb); // applies pending migrations to the staged copy only
    try {
      if (schemaVersion > currentSchema) {
        throw new AppError('RESTORE', 'This backup requires a newer version of Dentiva Pro.');
      }
      const tables = new Set(
        (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
      );
      for (const required of REQUIRED_TABLES) {
        if (!tables.has(required)) throw new AppError('RESTORE', `Backup database is missing required table "${required}".`);
      }
      const rows = db.prepare('SELECT stored_name, size, sha256 FROM attachments').all() as { stored_name: string; size: number; sha256: string }[];
      let missing = 0;
      for (const row of rows) {
        // Windows builds store stored_name with backslashes; normalise before validating.
        let rel: string;
        try {
          rel = validateRelativePath(String(row.stored_name).replace(/\\/g, '/'), { maxDepth: ARCHIVE_LIMITS.maxAttachmentDepth });
        } catch {
          throw new AppError('RESTORE', 'Backup database references an unsafe attachment path.');
        }
        const file = resolveInside(stagedAttachments, rel);
        if (!fs.existsSync(file)) { missing++; continue; }
        const st = fs.statSync(file);
        if (st.size !== Number(row.size) || sha256Sync(file) !== row.sha256) {
          throw new AppError('RESTORE', `Attachment "${rel}" does not match the backup's records.`);
        }
      }
      if (missing > 0) {
        throw new AppError('RESTORE', `Backup is missing ${missing} attachment file(s) referenced by its records. Restore was cancelled; your current data is unchanged.`);
      }
    } finally {
      db.close();
    }
  }

  function sha256Sync(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }

  /** Returns true when an automatic backup was due and has been attempted. */
  async function autoBackupIfDue(ctx: PlainCtx): Promise<boolean> {
    const setting = readBackupSetting();
    if (!setting.autoFrequencyDays || !setting.destination) return false;
    const last = holder.get()
      .prepare("SELECT MAX(created_at) last FROM backups WHERE kind IN ('auto','manual') AND status = 'ok'")
      .get<{ last: string | null }>()!;
    if (last.last) {
      const days = (Date.now() - new Date(last.last).getTime()) / 86400000;
      if (days < setting.autoFrequencyDays) return false;
    }
    try {
      await runBackup(ctx, setting.destination, 'auto');
      return true;
    } catch (e: any) {
      // failure notification already recorded by runBackup
      void e;
      return true;
    }
  }

  return { runBackup, listBackups, restoreBackup, autoBackupIfDue, readBackupSetting };
}

export type BackupService = ReturnType<typeof createBackupService>;
