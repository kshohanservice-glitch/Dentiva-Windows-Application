/**
 * Upgrade path from the released v4.2.2 database (schema 7) to 4.3.0 (schema 8).
 *
 * tests/fixtures/v4.2.2/dentiva-v4.2.2.db is produced by the REAL v4.2.2 schema
 * code (see scripts/build-v422-fixture.mjs) and seeded with the rows a clinic of
 * that version would have, including the historic print profiles — A4, A5 and a
 * 80mm thermal receipt — and one hand-added custom-millimetre profile.
 *
 * The 4.3.0 changes that this test is about:
 *   - migration 008 `a4-only-printing` rewrites `settings.printProfiles` so no
 *     stored profile carries a page size any more;
 *   - nothing clinical or financial is touched, and the rewrite is audited.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, schemaVersionOf, fullIntegrityCheck, type DB } from '../../src/main/db/database';
import { MIGRATIONS } from '../../src/main/db/migrations';
import { PRINT_DOCUMENT_TYPES } from '../../src/shared/print-page';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'v4.2.2', 'dentiva-v4.2.2.db');
const CURRENT = MIGRATIONS.length;

let work: string;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-v422-'));
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

function copyFixture(name = 'legacy.db'): string {
  const dest = path.join(work, name);
  fs.copyFileSync(FIXTURE, dest);
  return dest;
}

const readProfiles = (db: DB): Record<string, unknown>[] => JSON.parse(
  (db.prepare("SELECT value_json FROM settings WHERE key = 'printProfiles'").get() as { value_json: string }).value_json,
) as Record<string, unknown>[];

/** summaries of every migration audit entry, in write order. */
function migrationAuditSummaries(db: DB): string[] {
  return (db.prepare("SELECT summary FROM audit_log WHERE action = 'system.migrate' ORDER BY id").all() as { summary: string }[])
    .map((row) => row.summary);
}

describe('v4.2.2 fixture', () => {
  it('is a genuine v4.2.2 database (user_version 7) whose profiles still describe a page size', () => {
    const { db, schemaVersion } = openDatabase(copyFixture('pre.db'), { runMigrations: false });
    try {
      expect(schemaVersion).toBe(7);
      const profiles = readProfiles(db);
      expect(profiles.map((p) => p.id)).toEqual(['rx-a4', 'rx-a5', 'inv-a4', 'inv-thermal', 'rx-custom']);
      expect(profiles.some((p) => p.paperSize === 'a5')).toBe(true);
      expect(profiles.some((p) => p.paperSize === 'thermal')).toBe(true);
      expect(profiles.some((p) => p.widthMm === 148)).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('upgrade from v4.2.2 to the current schema', () => {
  it('migrates to the current version with no integrity or foreign-key errors', () => {
    const file = copyFixture();
    const { db } = openDatabase(file, { runMigrations: true });
    try {
      expect(schemaVersionOf(db)).toBe(CURRENT);
      expect(db.pragma('foreign_key_check') as unknown[]).toHaveLength(0);
    } finally {
      db.close();
    }
    expect(fullIntegrityCheck(file).ok).toBe(true);
  });

  it('preserves the clinical and financial rows exactly', () => {
    const { db } = openDatabase(copyFixture(), { runMigrations: true });
    try {
      const count = (sql: string) => Number((db.prepare(sql).get() as { c: number }).c);
      expect(count('SELECT COUNT(*) c FROM patients')).toBe(2);
      expect(count('SELECT COUNT(*) c FROM appointments')).toBe(2);
      expect(count('SELECT COUNT(*) c FROM visits')).toBe(1);
      expect(count('SELECT COUNT(*) c FROM visit_treatments')).toBe(1);
      expect(count('SELECT COUNT(*) c FROM prescriptions')).toBe(1);
      expect(count('SELECT COUNT(*) c FROM prescription_items')).toBe(2);
      expect(count('SELECT COUNT(*) c FROM invoices')).toBe(1);
      expect(count('SELECT COUNT(*) c FROM invoice_items')).toBe(2);
      expect(count('SELECT COUNT(*) c FROM payments')).toBe(1);
      expect(Number((db.prepare('SELECT total_paisa t FROM invoices').get() as { t: number }).t)).toBe(1300000);
      expect(Number((db.prepare('SELECT amount_paisa a FROM payments').get() as { a: number }).a)).toBe(1300000);
      // The v4.2.2 medicine instruction survives the upgrade untouched.
      const instructions = (db.prepare('SELECT medicine_instruction m FROM prescription_items ORDER BY seq').all() as { m: string | null }[])
        .map((row) => row.m);
      expect(instructions).toEqual(['Take after meals with water.', null]);
    } finally {
      db.close();
    }
  });

  it('keeps the A4 profiles, converts the hand-added profile and removes the untouched legacy seeds', () => {
    const { db } = openDatabase(copyFixture(), { runMigrations: true });
    try {
      const profiles = readProfiles(db);
      // rx-a4 and inv-a4 are kept; the untouched seeds rx-a5 and inv-thermal are
      // removed; the clinic's own custom-millimetre profile is converted to A4
      // (V5-022) and keeps its landscape orientation; receipt and report get
      // their A4 defaults so no document type is left without a profile.
      expect(profiles.map((p) => p.id)).toEqual(['rx-a4', 'inv-a4', 'rx-a4-2', 'rc-a4', 'rp-a4']);
      expect(profiles[2]).toMatchObject({ name: 'Prescription A4 (converted)', documentType: 'prescription', orientation: 'landscape' });
      for (const profile of profiles) {
        expect(profile.paperSize, JSON.stringify(profile)).toBeUndefined();
        expect(profile.widthMm).toBeUndefined();
        expect(profile.heightMm).toBeUndefined();
        expect(Object.keys(profile).sort()).toEqual(
          ['copies', 'documentType', 'id', 'margins', 'name', 'orientation', 'printerName', 'scale'],
        );
      }
      for (const type of PRINT_DOCUMENT_TYPES) {
        expect(profiles.some((p) => p.documentType === type), type).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('records the print-profile rewrite in the append-only audit log', () => {
    const { db } = openDatabase(copyFixture(), { runMigrations: true });
    try {
      const rows = db.prepare(
        "SELECT summary, before_json, after_json FROM audit_log WHERE action = 'system.migrate' AND entity_type = 'system' AND entity_id = 'print-profiles' ORDER BY id",
      ).all() as { summary: string; before_json: string | null; after_json: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].summary).toMatch(/A4-only printing: \d+ A4 profile\(s\) kept, \d+ converted to A4, \d+ unchanged legacy default\(s\) removed, \d+ A4 default\(s\) added\./);
      // 5 stored profiles -> the 2 A4 ones kept, the hand-added custom-millimetre
      // profile converted, the 2 untouched legacy seeds (A5, 80mm thermal)
      // removed, and the receipt + report defaults added (V5-022).
      expect(rows[0].summary).toContain('2 A4 profile(s) kept, 1 converted to A4, 2 unchanged legacy default(s) removed, 2 A4 default(s) added.');
      expect(JSON.parse(rows[0].after_json)).toEqual({
        kept: ['rx-a4', 'inv-a4'],
        converted: [{ from: 'rx-custom', to: 'rx-a4-2', medium: 'custom 148 × 210 mm', printerCleared: false }],
        removedLegacyDefaults: ['rx-a5', 'inv-thermal'],
        seeded: ['rc-a4', 'rp-a4'],
        droppedInvalid: 0,
      });
      // The complete pre-conversion row is kept in the audit entry for review.
      const before = JSON.parse(rows[0].before_json!) as { id: string }[];
      expect(before.map((p) => p.id)).toEqual(['rx-a4', 'rx-a5', 'inv-a4', 'inv-thermal', 'rx-custom']);
    } finally {
      db.close();
    }
  });

  it('is idempotent: reopening migrates nothing and does not duplicate the audit entry', () => {
    const file = copyFixture();
    const first = openDatabase(file, { runMigrations: true });
    const auditsAfterMigrating = migrationAuditSummaries(first.db);
    const profilesAfterMigrating = readProfiles(first.db);
    first.db.close();

    const { db, schemaVersion } = openDatabase(file, { runMigrations: true });
    try {
      expect(schemaVersion).toBe(CURRENT);
      expect(migrationAuditSummaries(db)).toEqual(auditsAfterMigrating);
      expect(readProfiles(db)).toEqual(profilesAfterMigrating);
    } finally {
      db.close();
    }
  });
});
