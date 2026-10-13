/**
 * Upgrade path from the released v3.0.3 database.
 *
 * tests/fixtures/v3.0.3/dentiva-v3.0.3.db is produced by the REAL v3.0.3 schema
 * code (see scripts/build-v303-fixture.mjs) and seeded with legacy rows. These tests
 * prove the current migrations: preserve every legacy row, archive (never drop)
 * queue data, keep the database intact, are idempotent, refuse downgrades, and
 * restore a v3.0.3 backup into the current schema.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import archiver from 'archiver';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { openDatabase, schemaVersionOf, fullIntegrityCheck, type DB } from '../../src/main/db/database';
import { MIGRATIONS } from '../../src/main/db/migrations';
import { createBackupService, type DbHolder } from '../../src/main/services/backup';
import { listPatients } from '../../src/main/services/patients';
import { listAgenda } from '../../src/main/services/appointments';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'v3.0.3', 'dentiva-v3.0.3.db');
const CURRENT = MIGRATIONS.length;

let env: TestEnv;
let work: string;

beforeEach(() => {
  env = createTestEnv('migration-v303');
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-v303-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanupEnv(env);
  fs.rmSync(work, { recursive: true, force: true });
});

function copyFixture(name = 'legacy.db'): string {
  const dest = path.join(work, name);
  fs.copyFileSync(FIXTURE, dest);
  return dest;
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('v3.0.3 fixture', () => {
  it('is a genuine v3.0.3 database (user_version 2, no 3.1 columns) with legacy data', () => {
    const { db, schemaVersion } = openDatabase(copyFixture('pre.db'), { runMigrations: false });
    try {
      expect(schemaVersion).toBe(2);
      const cols = (db.prepare("PRAGMA table_info(appointments)").all() as { name: string }[]).map((c) => c.name);
      expect(cols).not.toContain('expired_at');
      expect(cols).not.toContain('planned_treatments');
      expect((db.prepare('SELECT COUNT(*) c FROM queue_entries').get() as { c: number }).c).toBe(2);
      expect((db.prepare("SELECT COUNT(*) c FROM permissions WHERE key LIKE 'queue.%'").get() as { c: number }).c).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});

describe('upgrade from v3.0.3 to the current schema', () => {
  it('migrates to the current version and reports no integrity or foreign-key errors', () => {
    const file = copyFixture();
    const { db, schemaVersion } = openDatabase(file, { runMigrations: true });
    try {
      expect(schemaVersion).toBe(CURRENT);
      expect(db.pragma('foreign_key_check') as unknown[]).toHaveLength(0);
    } finally {
      db.close();
    }
    expect(fullIntegrityCheck(file).ok).toBe(true);
  });

  it('preserves every legacy patient, appointment, invoice, payment and visit-flow row', () => {
    const { db } = openDatabase(copyFixture(), { runMigrations: true });
    try {
      const count = (sql: string) => Number((db.prepare(sql).get() as { c: number }).c);
      expect(count('SELECT COUNT(*) c FROM patients')).toBe(2);
      expect(count('SELECT COUNT(*) c FROM appointments')).toBe(4);
      expect(count('SELECT COUNT(*) c FROM invoices')).toBe(1);
      expect(count('SELECT COUNT(*) c FROM payments')).toBe(1);
      expect(count('SELECT COUNT(*) c FROM invoice_items')).toBe(1);
      // Legacy appointment statuses keep their stored value; they are never rewritten.
      const statuses = (db.prepare('SELECT status FROM appointments ORDER BY id').all() as { status: string }[]).map((r) => r.status);
      expect(statuses).toEqual(['completed', 'arrived', 'scheduled', 'no_show']);
      expect(Number((db.prepare('SELECT amount_paisa a FROM payments').get() as { a: number }).a)).toBe(150000);
      expect(Number((db.prepare('SELECT total_paisa t FROM invoices').get() as { t: number }).t)).toBe(150000);
    } finally {
      db.close();
    }
  });

  it('archives legacy queue rows instead of dropping them, and retires only the queue permissions', () => {
    const { db } = openDatabase(copyFixture(), { runMigrations: true });
    try {
      // The table survives with its rows (dormant archive, no screen reads it).
      const rows = db.prepare('SELECT day, queue_no, status FROM queue_entries ORDER BY id').all() as { day: string; queue_no: number; status: string }[];
      expect(rows).toEqual([
        { day: '2026-09-28', queue_no: 1, status: 'completed' },
        { day: '2026-09-29', queue_no: 1, status: 'in_treatment' },
      ]);
      expect((db.prepare("SELECT COUNT(*) c FROM permissions WHERE key LIKE 'queue.%'").get() as { c: number }).c).toBe(0);
      expect((db.prepare("SELECT COUNT(*) c FROM role_permissions WHERE permission_key LIKE 'queue.%'").get() as { c: number }).c).toBe(0);
      // Non-queue permissions are untouched.
      expect((db.prepare("SELECT COUNT(*) c FROM permissions WHERE key LIKE 'appointments.%'").get() as { c: number }).c).toBeGreaterThan(0);
      const audit = db.prepare("SELECT summary FROM audit_log WHERE action = 'system.migrate' AND entity_id = 'queue'").get() as { summary: string } | undefined;
      expect(audit?.summary).toContain('2 legacy queue row(s) archived, not deleted');
    } finally {
      db.close();
    }
  });

  it('is idempotent: reopening a migrated database changes nothing and writes no second audit row', () => {
    const file = copyFixture();
    openDatabase(file, { runMigrations: true }).db.close();
    const hashAfterFirst = sha256(file);
    const reopened = openDatabase(file, { runMigrations: true });
    try {
      expect(reopened.schemaVersion).toBe(CURRENT);
      const audits = (reopened.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'system.migrate'").get() as { c: number }).c;
      expect(Number(audits)).toBe(1);
    } finally {
      reopened.db.close();
    }
    expect(sha256(file)).toBe(hashAfterFirst);
  });

  it('keeps the migrated legacy data readable through the current services', () => {
    const { db } = openDatabase(copyFixture(), { runMigrations: true });
    env.db.close();
    env.db = db as DB;
    const ctx = ownerCtx(env);
    expect(listPatients(ctx, { range: 'all' }).total).toBe(2);
    // Legacy 'arrived' and 'scheduled' rows are open; the 2026-09-29 row is already past.
    const agenda = listAgenda(ctx, { view: 'upcoming' });
    expect(agenda.map((a) => a.date)).toEqual(['2026-10-20']);
  });

  it('refuses to open a database written by a newer version (downgrade is not supported)', () => {
    const file = copyFixture('newer.db');
    const first = openDatabase(file, { runMigrations: true });
    first.db.pragma(`user_version = ${CURRENT + 1}`);
    first.db.close();
    expect(() => openDatabase(file, { runMigrations: true })).toThrow(/newer version/i);
    // A rejected database must not leave an open SQLite file handle on Windows.
    const moved = `${file}.moved`;
    fs.renameSync(file, moved);
    expect(fs.existsSync(moved)).toBe(true);
  });
});

describe('backup and restore across the schema change', () => {
  /** Build a genuine v3.0.3-format .dpv from the fixture (manifest says schema 2). */
  async function v303Backup(): Promise<string> {
    const dbCopy = copyFixture('backup-src.db');
    const dbBuf = fs.readFileSync(dbCopy);
    const manifest = Buffer.from(JSON.stringify({
      format: 'dentiva-backup', formatVersion: 1, appVersion: '3.0.3', schemaVersion: 2,
      createdAt: '2026-09-29T00:00:00.000Z', kind: 'manual',
      dbSha256: crypto.createHash('sha256').update(dbBuf).digest('hex'),
      counts: { patients: 2, visits: 0, invoices: 1 },
    }));
    const out = path.join(work, 'v3.0.3-backup.dpv');
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createWriteStream(out);
      const a = archiver('zip', { zlib: { level: 6 } });
      stream.on('close', () => resolve());
      a.on('error', reject);
      a.pipe(stream);
      a.append(manifest, { name: 'manifest.json' });
      a.append(dbBuf, { name: 'database/dentiva.db' });
      void a.finalize();
    });
    return out;
  }

  it('restores a v3.0.3 backup into the current app, migrating the restored copy', async () => {
    const holder: DbHolder = { get: () => env.db, set: (db: DB) => { env.db = db; } };
    const service = createBackupService({ paths: env.paths, holder, appVersion: 'test', notify: () => {} });
    const file = await v303Backup();
    await service.restoreBackup(ownerCtx(env), file, 'RESTORE');
    expect(schemaVersionOf(env.db)).toBe(CURRENT);
    expect(listPatients(ownerCtx(env), { range: 'all' }).total).toBe(2);
    expect(fullIntegrityCheck(env.paths.dbFile).ok).toBe(true);
  });

  it('refuses a backup written by a newer schema instead of loading it', async () => {
    const holder: DbHolder = { get: () => env.db, set: (db: DB) => { env.db = db; } };
    const service = createBackupService({ paths: env.paths, holder, appVersion: 'test', notify: () => {} });
    const dbBuf = fs.readFileSync(copyFixture('future-src.db'));
    const manifest = Buffer.from(JSON.stringify({
      format: 'dentiva-backup', formatVersion: 1, appVersion: '9.9.9', schemaVersion: CURRENT + 1,
      createdAt: '2026-09-29T00:00:00.000Z', kind: 'manual',
      dbSha256: crypto.createHash('sha256').update(dbBuf).digest('hex'), counts: {},
    }));
    const out = path.join(work, 'future.dpv');
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createWriteStream(out);
      const a = archiver('zip', { zlib: { level: 6 } });
      stream.on('close', () => resolve());
      a.on('error', reject);
      a.pipe(stream);
      a.append(manifest, { name: 'manifest.json' });
      a.append(dbBuf, { name: 'database/dentiva.db' });
      void a.finalize();
    });
    await expect(service.restoreBackup(ownerCtx(env), out, 'RESTORE')).rejects.toThrow();
    expect(schemaVersionOf(env.db)).toBe(CURRENT);
    expect(fullIntegrityCheck(env.paths.dbFile).ok).toBe(true);
  });
});
