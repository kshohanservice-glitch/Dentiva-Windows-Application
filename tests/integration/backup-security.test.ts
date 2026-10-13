/**
 * Malicious-archive fixtures for restore. Each test builds a hostile or
 * damaged .dpv, runs the real restore path against a scratch database and
 * proves: (a) nothing is written outside the staging area, (b) the live
 * database and attachments are not partially changed, (c) no staging debris
 * is left behind. Destructive recovery is only ever exercised on temp data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { createBackupService, type DbHolder } from '../../src/main/services/backup';
import { fullIntegrityCheck, type DB } from '../../src/main/db/database';
import { createPatient, listPatients } from '../../src/main/services/patients';
import type { Ctx } from '../../src/main/core/context';

let env: TestEnv;
let holder: DbHolder;
let service: ReturnType<typeof createBackupService>;
let ctx: Ctx;
let work: string;

beforeEach(() => {
  env = createTestEnv('backup-sec');
  holder = { get: () => env.db, set: (db: DB) => { env.db = db; } };
  service = createBackupService({ paths: env.paths, holder, appVersion: 'test', notify: () => {} });
  ctx = ownerCtx(env);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-evil-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanupEnv(env);
  fs.rmSync(work, { recursive: true, force: true });
});

type Entry = { name: string; data?: Buffer; directory?: boolean; symlinkTarget?: string };

async function buildZip(file: string, entries: Entry[]): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const a = archiver('zip', { zlib: { level: 6 } });
    out.on('close', () => resolve());
    a.on('error', reject);
    a.pipe(out);
    for (const e of entries) {
      if (e.symlinkTarget !== undefined) a.symlink(e.name, e.symlinkTarget);
      else if (e.directory) a.append(null as unknown as Buffer, { name: e.name, type: 'directory' } as any);
      else a.append(e.data ?? Buffer.alloc(0), { name: e.name });
    }
    void a.finalize();
  });
  return file;
}

/** Read every entry of an existing backup so a hostile variant can be built from a real one. */
async function readEntries(zipPath: string): Promise<Map<string, Buffer>> {
  const zip = await unzipper.Open.file(zipPath);
  const out = new Map<string, Buffer>();
  for (const f of zip.files) {
    if (f.type === 'File') out.set(f.path, await f.buffer());
  }
  return out;
}

function sha(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function manifestFor(db: Buffer, extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    format: 'dentiva-backup', formatVersion: 1, appVersion: 'test', schemaVersion: 2,
    createdAt: new Date().toISOString(), kind: 'manual', dbSha256: sha(db),
    counts: { patients: 0, visits: 0, invoices: 0 }, ...extra,
  }));
}

/** Creates a real backup with two patients and one stored attachment. */
async function realBackup(): Promise<{ file: string; entries: Map<string, Buffer> }> {
  createPatient(ctx, { name: 'Trusted Patient', gender: 'male', ageYears: 40, phone: '01811111111' });
  const attDir = path.join(env.paths.attachmentsDir, 'patient', '1');
  fs.mkdirSync(attDir, { recursive: true });
  fs.writeFileSync(path.join(attDir, 'scan.txt'), 'original attachment');
  const rec = await service.runBackup(ctx, path.join(env.dir, 'dest'), 'manual');
  // Attachment metadata must match what the database claims.
  const payload = Buffer.from('original attachment');
  env.db.prepare(
    `INSERT INTO attachments (entity_type, entity_id, stored_name, original_name, mime, size, sha256, uploaded_by, uploaded_at)
     VALUES ('patient', 1, ?, 'scan.txt', 'text/plain', ?, ?, 1, ?)`,
  ).run(path.join('patient', '1', 'scan.txt'), payload.length, sha(payload), new Date().toISOString());
  const rec2 = await service.runBackup(ctx, path.join(env.dir, 'dest'), 'manual');
  void rec;
  return { file: rec2.path, entries: await readEntries(rec2.path) };
}

function snapshotLive(): { patients: number; dbHash: string; attachments: string[] } {
  const dbBytes = fs.readFileSync(env.paths.dbFile);
  const attachments = fs.existsSync(env.paths.attachmentsDir)
    ? fs.readdirSync(env.paths.attachmentsDir, { recursive: true }).map(String).sort()
    : [];
  return { patients: listPatients(ctx, {}).total, dbHash: sha(dbBytes), attachments };
}

function expectLiveUnchanged(before: ReturnType<typeof snapshotLive>): void {
  // Use the currently bound handle: a restore may replace it.
  expect(listPatients(ownerCtx(env), {}).total).toBe(before.patients);
  expect(fullIntegrityCheck(env.paths.dbFile).ok).toBe(true);
  const after = fs.existsSync(env.paths.attachmentsDir)
    ? fs.readdirSync(env.paths.attachmentsDir, { recursive: true }).map(String).sort()
    : [];
  expect(after).toEqual(before.attachments);
}

function expectNoEscape(): void {
  // Anything written "outside" the restore staging would land in these places.
  expect(fs.existsSync(path.join(env.dir, 'escape.txt'))).toBe(false);
  expect(fs.existsSync(path.join(env.dir, 'evil.txt'))).toBe(false);
  expect(fs.existsSync(path.join(os.tmpdir(), 'escape.txt'))).toBe(false);
}

function expectNoStagingDebris(): void {
  const tmp = env.paths.tempDir;
  const leftovers = fs.existsSync(tmp) ? fs.readdirSync(tmp).filter((n) => n.startsWith('restore-')) : [];
  expect(leftovers).toEqual([]);
}

describe('restore rejects hostile archives without touching live data', () => {
  it('rejects path traversal inside attachments', async () => {
    const { entries } = await realBackup();
    const file = await buildZip(path.join(work, 'traversal.dpv'), [
      ...[...entries].map(([name, data]) => ({ name, data })),
      { name: 'attachments/../../escape.txt', data: Buffer.from('pwned') },
    ]);
    const before = snapshotLive();
    await expect(service.restoreBackup(ctx, file, 'RESTORE')).rejects.toThrow(/Unsafe path segment|escapes/);
    expectNoEscape();
    expectLiveUnchanged(before);
    expectNoStagingDebris();
  });

  it('rejects Windows drive prefixes and reserved device names', async () => {
    const { entries } = await realBackup();
    const base = [...entries].map(([name, data]) => ({ name, data }));
    const drive = await buildZip(path.join(work, 'drive.dpv'), [...base, { name: 'attachments/C:evil.txt', data: Buffer.from('x') }]);
    await expect(service.restoreBackup(ctx, drive, 'RESTORE')).rejects.toThrow(/forbidden|Forbidden|character/i);
    const reserved = await buildZip(path.join(work, 'reserved.dpv'), [...base, { name: 'attachments/CON', data: Buffer.from('x') }]);
    await expect(service.restoreBackup(ctx, reserved, 'RESTORE')).rejects.toThrow(/reserved/i);
    expectNoEscape();
  });

  it('rejects duplicate and case-colliding entries', async () => {
    const { entries } = await realBackup();
    const base = [...entries].map(([name, data]) => ({ name, data }));
    const dup = await buildZip(path.join(work, 'dup.dpv'), [...base, { name: 'attachments/x.txt', data: Buffer.from('1') }, { name: 'attachments/x.txt', data: Buffer.from('2') }]);
    await expect(service.restoreBackup(ctx, dup, 'RESTORE')).rejects.toThrow(/Duplicate/);
    const collide = await buildZip(path.join(work, 'collide.dpv'), [...base, { name: 'attachments/Note.txt', data: Buffer.from('1') }, { name: 'attachments/note.TXT', data: Buffer.from('2') }]);
    await expect(service.restoreBackup(ctx, collide, 'RESTORE')).rejects.toThrow(/Duplicate/);
  });

  it('rejects symbolic links in the archive', async () => {
    const { entries } = await realBackup();
    const base = [...entries].map(([name, data]) => ({ name, data }));
    const link = await buildZip(path.join(work, 'symlink.dpv'), [...base, { name: 'attachments/link.txt', symlinkTarget: '/etc/passwd' }]);
    const before = snapshotLive();
    await expect(service.restoreBackup(ctx, link, 'RESTORE')).rejects.toThrow(/Symbolic links/);
    expectLiveUnchanged(before);
  });

  it('rejects unexpected top-level files such as executables or scripts', async () => {
    const { entries } = await realBackup();
    const base = [...entries].map(([name, data]) => ({ name, data }));
    const file = await buildZip(path.join(work, 'toplevel.dpv'), [...base, { name: 'startup.bat', data: Buffer.from('del /s') }]);
    await expect(service.restoreBackup(ctx, file, 'RESTORE')).rejects.toThrow(/Unexpected file/);
    expectNoEscape();
  });

  it('rejects a database whose checksum does not match the manifest', async () => {
    const { entries } = await realBackup();
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8'));
    manifest.dbSha256 = '0'.repeat(64);
    const file = await buildZip(path.join(work, 'badsum.dpv'), [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      { name: 'database/dentiva.db', data: entries.get('database/dentiva.db')! },
    ]);
    const before = snapshotLive();
    await expect(service.restoreBackup(ctx, file, 'RESTORE')).rejects.toThrow(/checksum/);
    expectLiveUnchanged(before);
  });

  it('rejects a correctly-checksummed but corrupt database and keeps live data', async () => {
    const garbage = Buffer.from('this is not a sqlite database'.padEnd(8192, '\0'));
    const file = await buildZip(path.join(work, 'corruptdb.dpv'), [
      { name: 'manifest.json', data: manifestFor(garbage) },
      { name: 'database/dentiva.db', data: garbage },
    ]);
    createPatient(ctx, { name: 'Live Only', gender: 'female', ageYears: 30, phone: '01822222222' });
    const before = snapshotLive();
    await expect(service.restoreBackup(ctx, file, 'RESTORE')).rejects.toThrow();
    expectLiveUnchanged(before);
    expectNoStagingDebris();
  });

  it('rejects a backup whose database references an attachment the archive does not contain', async () => {
    const { entries } = await realBackup();
    // Build a backup-shaped archive that drops the attachment file but keeps its DB row.
    const base = [...entries].filter(([n]) => !n.startsWith('attachments/')).map(([name, data]) => ({ name, data }));
    const file = await buildZip(path.join(work, 'missing-att.dpv'), base);
    const before = snapshotLive();
    await expect(service.restoreBackup(ctx, file, 'RESTORE')).rejects.toThrow(/missing 1 attachment/);
    expectLiveUnchanged(before);
  });

  it('rejects a backup whose attachment bytes do not match the recorded hash', async () => {
    const { entries } = await realBackup();
    const base = [...entries].filter(([n]) => !n.startsWith('attachments/')).map(([name, data]) => ({ name, data }));
    const file = await buildZip(path.join(work, 'tampered-att.dpv'), [
      ...base,
      { name: 'attachments/patient/1/scan.txt', data: Buffer.from('TAMPERED') },
    ]);
    const before = snapshotLive();
    await expect(service.restoreBackup(ctx, file, 'RESTORE')).rejects.toThrow(/does not match/);
    expectLiveUnchanged(before);
  });

  it('rejects a backup whose database references an unsafe stored path', async () => {
    const { entries } = await realBackup();
    // Patch the database copy so a row points outside the attachments root.
    const tampered = path.join(work, 'tampered.db');
    fs.writeFileSync(tampered, entries.get('database/dentiva.db')!);
    const { default: Database } = await import('better-sqlite3');
    const raw = new Database(tampered);
    raw.prepare("UPDATE attachments SET stored_name = '../../outside.txt'").run();
    raw.close();
    const dbBytes = fs.readFileSync(tampered);
    const file = await buildZip(path.join(work, 'unsafe-path.dpv'), [
      { name: 'manifest.json', data: manifestFor(dbBytes) },
      { name: 'database/dentiva.db', data: dbBytes },
    ]);
    const before = snapshotLive();
    await expect(service.restoreBackup(ctx, file, 'RESTORE')).rejects.toThrow(/unsafe attachment path/);
    expectNoEscape();
    expectLiveUnchanged(before);
  });

  it('rejects a backup from a newer schema version', async () => {
    const { entries } = await realBackup();
    const file = await buildZip(path.join(work, 'future.dpv'), [
      { name: 'manifest.json', data: manifestFor(entries.get('database/dentiva.db')!, { schemaVersion: 99 }) },
      { name: 'database/dentiva.db', data: entries.get('database/dentiva.db')! },
    ]);
    await expect(service.restoreBackup(ctx, file, 'RESTORE')).rejects.toThrow(/newer version/);
  });

  it('rolls back the live database and attachments when the swap fails midway', async () => {
    const { file } = await realBackup();
    createPatient(ctx, { name: 'Changed After Backup', gender: 'female', ageYears: 22, phone: '01833333333' });
    const before = snapshotLive();
    expect(before.patients).toBe(2);

    // Fail the moment the staged attachments are moved into place (after the
    // database has already been swapped) to force the rollback branch.
    const realRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from: any, to: any) => {
      if (String(from).includes('restore-') && String(from).endsWith('attachments')) {
        throw new Error('simulated disk failure');
      }
      return realRename(from, to);
    });

    await expect(service.restoreBackup(ctx, file, 'RESTORE')).rejects.toThrow(/rolled back/);
    vi.restoreAllMocks();

    const live = ownerCtx(env);
    expect(listPatients(live, {}).total).toBe(2);
    expect(listPatients(live, {}).items.map((p) => p.name)).toContain('Changed After Backup');
    expect(fullIntegrityCheck(env.paths.dbFile).ok).toBe(true);
    expect(fs.readFileSync(path.join(env.paths.attachmentsDir, 'patient', '1', 'scan.txt'), 'utf8')).toBe('original attachment');
    expect(fs.readdirSync(env.dir).filter((n) => n.includes('.rollback-'))).toEqual([]);
    expectNoStagingDebris();
  });

  it('restores a valid backup byte-for-byte including attachments', async () => {
    const { file } = await realBackup();
    createPatient(ctx, { name: 'Later', gender: 'male', ageYears: 50, phone: '01844444444' });
    fs.writeFileSync(path.join(env.paths.attachmentsDir, 'stray.txt'), 'should disappear');

    await service.restoreBackup(ctx, file, 'RESTORE');
    const live = ownerCtx(env);
    const names = listPatients(live, {}).items.map((p) => p.name);
    expect(names).toEqual(['Trusted Patient']);
    expect(fs.readFileSync(path.join(env.paths.attachmentsDir, 'patient', '1', 'scan.txt'), 'utf8')).toBe('original attachment');
    expect(fs.existsSync(path.join(env.paths.attachmentsDir, 'stray.txt'))).toBe(false);
    expectNoStagingDebris();
  });
});
