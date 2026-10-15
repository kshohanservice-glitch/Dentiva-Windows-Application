import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors';
import { MIGRATIONS } from './migrations';

export type DB = Database.Database;

export interface OpenResult {
  db: DB;
  schemaVersion: number;
  /** Verified copy written before pending migrations ran (null when none were pending). */
  preMigrationCopy: string | null;
}

/** How many pre-migration safety copies are kept next to the database. */
export const PRE_MIGRATION_KEEP = 3;
export const PRE_MIGRATION_DIR = 'pre-migration';

function applyPragmas(db: DB): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 8000');
  db.pragma('temp_store = MEMORY');
}

export function migrate(db: DB): { from: number; to: number } {
  const current = Number(db.pragma('user_version', { simple: true }));
  const target = MIGRATIONS[MIGRATIONS.length - 1].version;
  if (current > target) {
    throw new AppError('INTERNAL', 'This database was created by a newer version of Dentiva Pro and cannot be opened.');
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const run = db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    });
    run();
  }
  return { from: current, to: Number(db.pragma('user_version', { simple: true })) };
}

/**
 * Write a verified, consistent copy of an existing database before pending
 * migrations change it (V5-007). Migrations are forward-only, so this copy is
 * the rollback path: if an upgrade misbehaves, the clinic's pre-upgrade data
 * is in `data/pre-migration/` (see docs/DATABASE.md, "Upgrade safety").
 *
 * The copy is made with `VACUUM INTO` (transactionally consistent, includes WAL
 * content), re-opened read-only and checked with `quick_check` and its schema
 * version before any migration runs. Failure refuses the upgrade: nothing is
 * migrated without a safety copy. Only the newest PRE_MIGRATION_KEEP copies are
 * kept.
 */
export function writePreMigrationCopy(db: DB, dbFile: string, fromVersion: number, toVersion: number): string {
  const dir = path.join(path.dirname(dbFile), PRE_MIGRATION_DIR);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const base = `${path.basename(dbFile, path.extname(dbFile))}-v${fromVersion}-to-v${toVersion}-${stamp}`;
  let target = path.join(dir, `${base}.db`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 2; fs.existsSync(target); n += 1) target = path.join(dir, `${base}-${n}.db`);
    db.prepare('VACUUM INTO ?').run(target);
    const check = new Database(target, { readonly: true, fileMustExist: true });
    try {
      const ok = check.pragma('quick_check', { simple: true });
      const version = Number(check.pragma('user_version', { simple: true }));
      if (ok !== 'ok' || version !== fromVersion) throw new Error(`verification failed (${String(ok)}, v${version})`);
    } finally {
      check.close();
    }
  } catch (err) {
    try { if (fs.existsSync(target)) fs.rmSync(target, { force: true }); } catch { /* best effort */ }
    throw new AppError(
      'INTERNAL',
      'Dentiva Pro could not write a safety copy of your database before upgrading it, so the upgrade was not started ' +
        'and no data was changed. Make sure the disk has free space and the data folder is writable, then start Dentiva Pro again.',
      { cause: err },
    );
  }
  // Retention: newest copies first (timestamped names sort chronologically).
  try {
    const copies = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse();
    for (const old of copies.slice(PRE_MIGRATION_KEEP)) fs.rmSync(path.join(dir, old), { force: true });
  } catch { /* best effort */ }
  return target;
}

/** Open (creating if needed), apply pragmas, run pending migrations, verify integrity. */
export function openDatabase(
  dbFile: string,
  opts: { runMigrations?: boolean; preMigrationCopy?: boolean } = {},
): OpenResult {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  let preMigrationCopy: string | null = null;
  try {
    applyPragmas(db);
    if (opts.runMigrations !== false) {
      const current = Number(db.pragma('user_version', { simple: true }));
      const target = MIGRATIONS[MIGRATIONS.length - 1].version;
      // An existing database (schema > 0) with pending migrations gets a
      // verified safety copy first. A brand-new database has nothing to save.
      if (opts.preMigrationCopy !== false && current > 0 && current < target) {
        const integrity = db.pragma('quick_check', { simple: true });
        if (integrity !== 'ok') {
          throw new AppError('INTERNAL', 'Database integrity check failed. Restore a backup from the recovery screen.', { details: { integrity } });
        }
        preMigrationCopy = writePreMigrationCopy(db, dbFile, current, target);
      }
      migrate(db);
      db.prepare("UPDATE teeth SET arch = 'upper' WHERE quadrant IN (5, 6) AND arch != 'upper'").run();
    }
    const integrity = db.pragma('quick_check', { simple: true });
    if (integrity !== 'ok') {
      throw new AppError('INTERNAL', 'Database integrity check failed. Restore a backup from the recovery screen.', { details: { integrity } });
    }
    return { db, schemaVersion: Number(db.pragma('user_version', { simple: true })), preMigrationCopy };
  } catch (error) {
    // Failed migrations/downgrades must release the Windows file handle too.
    // Otherwise a refused database remains locked until process exit.
    db.close();
    throw error;
  }
}

export function schemaVersionOf(db: DB): number {
  return Number(db.pragma('user_version', { simple: true }));
}

/** Full integrity check (used by restore validation). */
export function fullIntegrityCheck(dbFile: string): { ok: boolean; errors: string[] } {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma('integrity_check') as { integrity_check: string }[];
    const errors = rows.map((r) => r.integrity_check).filter((v) => v !== 'ok');
    return { ok: errors.length === 0, errors };
  } finally {
    db.close();
  }
}
