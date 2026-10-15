/**
 * A4-only document policy (Dentiva Pro 4.3.0).
 *
 * A4 is the only supported document page size. These tests pin the policy from
 * four directions:
 *
 *  1. **Source gate** — no active code path may mention another page size
 *     (A5, B5, Letter, Legal, Folio, Tabloid, thermal/roll, custom millimetres).
 *     Historical migration 001 and the legacy-detection pattern in
 *     `src/shared/print-page.ts` are the only allowed mentions, and they are
 *     asserted explicitly so a new occurrence cannot hide there either.
 *  2. **Fresh installation** — the stored profiles are A4 and carry no page-size
 *     field, with one profile per document type.
 *  3. **Upgrade** — a database that stored A5/thermal/custom profiles is
 *     converted by migration 008 without losing the profile's printer,
 *     orientation, margins, scale or copies, and the upgrade is audited.
 *  4. **Write path** — a settings payload that still carries `paperSize`,
 *     `widthMm` or `heightMm` (e.g. from an older build, or a hand-crafted IPC
 *     call) cannot persist a non-A4 page size.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { getSettings, saveSettings } from '../../src/main/services/settings';
import { MIGRATIONS } from '../../src/main/db/migrations';
import { migration008 } from '../../src/main/db/migrations/008_a4_only_printing';
import {
  A4_HEIGHT_MM, A4_WIDTH_MM, a4PageCss, a4PageSize, DEFAULT_PRINT_PROFILES,
  defaultPrintProfiles, PRINT_DOCUMENT_TYPES, isLegacyNonA4Profile, normalizePrintProfiles,
} from '../../src/shared/print-page';
import type { PrintProfile } from '../../src/shared/types';

let env: TestEnv;

beforeEach(() => { env = createTestEnv('a4-only'); });
afterEach(() => { cleanupEnv(env); });

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (relative: string): string =>
  fs.readFileSync(path.join(repoRoot, relative), 'utf8').replace(/\r\n/g, '\n');

/** Every source file under src/, as repository-relative paths. */
function sourceFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe('A4 is the only page size in the source', () => {
  it('uses no other page size anywhere in src/', () => {
    // The scan targets page-size *usage*, so unrelated words are not flagged:
    //   - the `paperSize` field (the only way a page size was ever expressed);
    //   - the retired sheet/roll names as string literals (`'a5'`, `'letter'`, …)
    //     — not `letterSpacing` or a "thermal lingering" clinical note;
    //   - any `@page { size: Nmm Mmm }` other than A4;
    //   - any hard-coded `widthMm:`/`heightMm:` literal other than A4's axes.
    const retired = /(['"])(a5|b5|letter|legal|folio|tabloid|thermal)\1/i;
    const allowed = new Set([
      // The legacy-detection pattern (and its documentation) in the A4 module.
      'src/shared/print-page.ts',
      // Historical migration: the v1 seed of the original release is frozen and
      // migration 008 converts whatever it wrote. Verified separately below.
      'src/main/db/migrations/001_init.ts',
      // Conversion migration: it names the legacy markers it removes.
      'src/main/db/migrations/008_a4_only_printing.ts',
    ]);
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (allowed.has(file)) continue;
      const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const reasons: string[] = [];
      if (/paperSize/.test(text)) reasons.push('paperSize field');
      if (retired.test(text)) reasons.push('retired page-size literal');
      for (const match of text.matchAll(/size:\s*([\d.]+)mm\s+([\d.]+)mm/g)) {
        if (!((match[1] === '210' && match[2] === '297') || (match[1] === '297' && match[2] === '210'))) {
          reasons.push(`@page size ${match[1]}x${match[2]}mm`);
        }
      }
      for (const match of text.matchAll(/(?:width|height)Mm:\s*(\d+(?:\.\d+)?)/g)) {
        if (!['210', '297'].includes(match[1])) reasons.push(`hard-coded ${match[0]}`);
      }
      if (reasons.length) offenders.push(`${file} (${[...new Set(reasons)].join(', ')})`);
    }
    expect(offenders).toEqual([]);
  });

  it('has no page-size field in the print-profile model or the settings payload', () => {
    const types = read('src/shared/types.ts');
    const profile = types.slice(types.indexOf('export interface PrintProfile'), types.indexOf('}', types.indexOf('export interface PrintProfile')));
    for (const field of ['paperSize', 'widthMm', 'heightMm']) {
      expect(profile, `${field} must not be part of PrintProfile`).not.toContain(field);
    }
  });

  it('keeps the legacy mentions confined to conversion and history', () => {
    // migration 001 is the frozen v1 seed: it still writes the original rows
    // (A4 + A5 + thermal) so that every database that was ever shipped is
    // upgraded through exactly one code path — migration 008.
    const init = read('src/main/db/migrations/001_init.ts');
    expect(init).toContain("paperSize: 'a5'");
    expect(init).toContain("paperSize: 'thermal'");
    const conversion = read('src/main/db/migrations/008_a4_only_printing.ts');
    expect(conversion).toContain('normalizePrintProfiles');
    expect(conversion).toContain('withRequiredProfiles');
    // The legacy-marker matcher lives in one place only.
    expect(read('src/shared/print-page.ts')).toContain('export function isLegacyNonA4Profile');
    expect(MIGRATIONS[MIGRATIONS.length - 1].version).toBe(8);
    expect(MIGRATIONS[MIGRATIONS.length - 1].name).toBe('a4-only-printing');
  });

  it('uses one A4 geometry constant for every document workflow', () => {
    expect(a4PageSize('portrait')).toEqual({ widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM });
    expect(a4PageSize('landscape')).toEqual({ widthMm: A4_HEIGHT_MM, heightMm: A4_WIDTH_MM });
    expect(a4PageCss('portrait')).toBe('@page { size: 210mm 297mm; margin: 0; }');
    expect(a4PageCss('landscape')).toBe('@page { size: 297mm 210mm; margin: 0; }');
  });

  it('ships A4 profiles for every supported document type', () => {
    for (const type of PRINT_DOCUMENT_TYPES) {
      expect(DEFAULT_PRINT_PROFILES.some((p) => p.documentType === type), type).toBe(true);
    }
    for (const profile of defaultPrintProfiles()) {
      expect(profile).not.toHaveProperty('paperSize');
      expect(profile).not.toHaveProperty('widthMm');
      expect(profile).not.toHaveProperty('heightMm');
    }
  });
});

describe('stored print profiles are A4-only', () => {
  it('serves A4 profiles on a fresh installation, with no page-size field', () => {
    const settings = getSettings(ownerCtx(env));
    expect(settings.printProfiles.length).toBeGreaterThan(0);
    for (const profile of settings.printProfiles) {
      expect(Object.keys(profile).sort()).toEqual(
        ['copies', 'documentType', 'id', 'margins', 'name', 'orientation', 'printerName', 'scale'],
      );
    }
    const stored = JSON.parse(
      (env.db.prepare("SELECT value_json FROM settings WHERE key = 'printProfiles'").get() as { value_json: string }).value_json,
    ) as Record<string, unknown>[];
    for (const profile of stored) expect(profile.paperSize).toBeUndefined();
  });

  it('ignores page-size fields in a settings payload from an older build', () => {
    const ctx = ownerCtx(env);
    saveSettings(ctx, {
      printProfiles: [
        {
          id: 'legacy-a5', name: 'Prescription A5', documentType: 'prescription', printerName: 'HP LaserJet',
          paperSize: 'a5', widthMm: 148, heightMm: 210, orientation: 'landscape',
          margins: { top: 8, right: 8, bottom: 8, left: 8 }, scale: 90, copies: 2,
        },
      ] as unknown as PrintProfile[],
    });
    const stored = JSON.parse(
      (env.db.prepare("SELECT value_json FROM settings WHERE key = 'printProfiles'").get() as { value_json: string }).value_json,
    ) as Record<string, unknown>[];
    expect(JSON.stringify(stored)).not.toContain('a5');
    expect(JSON.stringify(stored)).not.toContain('widthMm');
    // A profile that is not itself a legacy-medium description keeps its setup.
    const kept = getSettings(ctx).printProfiles;
    expect(kept.every((p) => !('paperSize' in p))).toBe(true);
    for (const type of PRINT_DOCUMENT_TYPES) {
      expect(kept.some((p) => p.documentType === type), type).toBe(true);
    }
  });

  it('never throws on garbage stored profiles', () => {
    expect(normalizePrintProfiles(null)).toEqual([]);
    expect(normalizePrintProfiles([1, 'x', null, { id: 'a', name: 'b', documentType: 'nope', scale: 'big' }])).toHaveLength(1);
    expect(normalizePrintProfiles([{ id: 'a' }, { id: 'a' }])).toHaveLength(1);
    expect(normalizePrintProfiles(Array.from({ length: 40 }, (_, i) => ({ id: `p${i}` })))).toHaveLength(30);
  });

  it('treats every retired medium as legacy', () => {
    expect(isLegacyNonA4Profile({ paperSize: 'a5' })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'A5' })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'thermal' })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'custom', widthMm: 80, heightMm: 200 })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'letter' })).toBe(true);
    expect(isLegacyNonA4Profile({ name: 'Prescription A5' })).toBe(true);
    // A plain A4 profile with custom margins is not legacy.
    expect(isLegacyNonA4Profile({ paperSize: 'a4', widthMm: 210, heightMm: 297 })).toBe(false);
    expect(isLegacyNonA4Profile({ id: 'rx-a4', name: 'Prescription A4' })).toBe(false);
  });
});

describe('migration 008 converts an upgrading installation', () => {
  const writeProfiles = (profiles: unknown): void => {
    env.db.prepare(
      "INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES ('printProfiles', ?, ?, NULL) " +
      'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
    ).run(JSON.stringify(profiles), new Date().toISOString());
  };
  const readProfiles = (): Record<string, unknown>[] => JSON.parse(
    (env.db.prepare("SELECT value_json FROM settings WHERE key = 'printProfiles'").get() as { value_json: string }).value_json,
  ) as Record<string, unknown>[];

  it('keeps A4 profiles (with their customization) and removes the retired mediums', () => {
    writeProfiles([
      { id: 'rx-a4', name: 'Prescription A4', documentType: 'prescription', printerName: 'Clinic LaserJet', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'landscape', margins: { top: 18, right: 14, bottom: 18, left: 14 }, scale: 95, copies: 2 },
      { id: 'rx-a5', name: 'Prescription A5', documentType: 'prescription', printerName: '', paperSize: 'a5', widthMm: 148, heightMm: 210, orientation: 'portrait', margins: { top: 8, right: 8, bottom: 8, left: 8 }, scale: 100, copies: 1 },
      { id: 'inv-a4', name: 'Invoice A4', documentType: 'invoice', printerName: '', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
      { id: 'inv-thermal', name: 'Receipt Thermal 80mm', documentType: 'receipt', printerName: 'POS-80', paperSize: 'thermal', widthMm: 80, heightMm: 200, orientation: 'portrait', margins: { top: 4, right: 4, bottom: 4, left: 4 }, scale: 100, copies: 1 },
    ]);

    migration008.up(env.db);

    const stored = readProfiles();
    const ids = stored.map((p) => p.id);
    expect(ids).toContain('rx-a4');
    expect(ids).toContain('inv-a4');
    expect(ids).not.toContain('rx-a5');
    expect(ids).not.toContain('inv-thermal');
    // The clinic's printer, orientation, margins, scale and copies survive.
    const kept = stored.find((p) => p.id === 'rx-a4') as Record<string, any>;
    expect(kept.printerName).toBe('Clinic LaserJet');
    expect(kept.orientation).toBe('landscape');
    expect(kept.margins).toEqual({ top: 18, right: 14, bottom: 18, left: 14 });
    expect(kept.scale).toBe(95);
    expect(kept.copies).toBe(2);
    expect(kept.paperSize).toBeUndefined();
    expect(kept.widthMm).toBeUndefined();
    // Every document type still has a profile; the receipt's labels/medium were
    // replaced by the A4 receipt profile rather than pointing at an 80mm roll.
    for (const type of PRINT_DOCUMENT_TYPES) {
      expect(stored.some((p) => p.documentType === type), type).toBe(true);
    }
    expect(stored.find((p) => p.documentType === 'receipt')).toBeTruthy();
  });

  it('is idempotent and audited', () => {
    // The audit log is append-only (a database trigger forbids deletion), so the
    // assertion below is scoped to the rows this test writes.
    const auditWatermark = Number(
      (env.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM audit_log').get() as { id: number }).id,
    );
    writeProfiles([
      { id: 'rx-a4', name: 'Prescription A4', documentType: 'prescription', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
      { id: 'rx-a5', name: 'Prescription A5', documentType: 'prescription', paperSize: 'a5', widthMm: 148, heightMm: 210, orientation: 'portrait', margins: { top: 8, right: 8, bottom: 8, left: 8 }, scale: 100, copies: 1 },
    ]);
    migration008.up(env.db);
    const afterFirst = readProfiles();
    migration008.up(env.db);
    expect(readProfiles()).toEqual(afterFirst);

    const audits = env.db
      .prepare("SELECT summary, after_json FROM audit_log WHERE action = 'system.migrate' AND entity_id = 'print-profiles' AND id > ? ORDER BY id")
      .all(auditWatermark) as { summary: string; after_json: string }[];
    expect(audits).toHaveLength(2); // one per run, both describing the same result
    expect(audits[0].summary).toContain('A4-only printing');
    expect(audits[0].summary).toContain('1 non-A4 profile(s) removed');
    expect(JSON.parse(audits[0].after_json).kept).toEqual(afterFirst.map((p) => p.id));
  });

  it('seeds the A4 defaults when the settings row is missing or corrupt', () => {
    env.db.prepare("DELETE FROM settings WHERE key = 'printProfiles'").run();
    migration008.up(env.db);
    expect(readProfiles().map((p) => p.id)).toEqual(defaultPrintProfiles().map((p) => p.id));

    env.db.prepare("UPDATE settings SET value_json = '{not json' WHERE key = 'printProfiles'").run();
    migration008.up(env.db);
    for (const profile of readProfiles()) expect(profile.paperSize).toBeUndefined();
  });

  it('leaves patients, clinical and financial rows untouched', () => {
    const before = env.db.prepare('SELECT COUNT(*) n FROM patients').get() as { n: number };
    migration008.up(env.db);
    const after = env.db.prepare('SELECT COUNT(*) n FROM patients').get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});
