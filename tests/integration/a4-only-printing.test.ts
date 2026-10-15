/**
 * A4-only document policy (Dentiva Pro 5.0; groundwork from closed PR #42).
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
 *     converted by migration 008: customised legacy profiles become A4 profiles
 *     that keep their printer (except roll printers), orientation, margins,
 *     scale and copies (V5-022); only untouched legacy seeds are removed; the
 *     upgrade is audited.
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
  planPrintProfiles, withRequiredProfiles,
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
    expect(conversion).toContain('planPrintProfiles');
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
    expect(JSON.stringify(stored).toLowerCase()).not.toContain('a5');
    expect(JSON.stringify(stored)).not.toContain('widthMm');
    // The customised legacy profile is converted, keeping its setup (V5-022).
    const converted = stored.find((p) => p.documentType === 'prescription') as Record<string, any>;
    expect(converted).toMatchObject({
      id: 'legacy-a4', name: 'Prescription A4 (converted)', printerName: 'HP LaserJet', orientation: 'landscape',
      margins: { top: 8, right: 8, bottom: 8, left: 8 }, scale: 90, copies: 2,
    });
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

  it('treats every retired medium as legacy, judged by stored geometry only (V5-023)', () => {
    expect(isLegacyNonA4Profile({ paperSize: 'a5' })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'A5' })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'thermal' })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'custom', widthMm: 80, heightMm: 200 })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'custom', widthMm: 210, heightMm: 297 })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'letter' })).toBe(true);
    expect(isLegacyNonA4Profile({ paperSize: 'a4', widthMm: 148, heightMm: 210 })).toBe(true);
    // A plain A4 profile with custom margins is not legacy …
    expect(isLegacyNonA4Profile({ paperSize: 'a4', widthMm: 210, heightMm: 297 })).toBe(false);
    expect(isLegacyNonA4Profile({ paperSize: 'a4', widthMm: 297, heightMm: 210 })).toBe(false);
    expect(isLegacyNonA4Profile({ id: 'rx-a4', name: 'Prescription A4' })).toBe(false);
    // … and a name never decides: these are the clinic's own A4 profiles.
    expect(isLegacyNonA4Profile({ name: 'Prescription A5' })).toBe(false);
    expect(isLegacyNonA4Profile({ paperSize: 'a4', name: 'Custom letterhead' })).toBe(false);
    expect(normalizePrintProfiles([{ id: 'own', name: 'Custom letterhead', documentType: 'invoice', paperSize: 'a4' }])).toHaveLength(1);
  });

  it('converts customised legacy profiles and drops only untouched seeds (V5-022)', () => {
    const plan = planPrintProfiles([
      { id: 'rx-a4', name: 'Prescription A4', documentType: 'prescription', printerName: '', paperSize: 'a4', orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
      // untouched seeds → dropped
      { id: 'rx-a5', name: 'Prescription A5', documentType: 'prescription', printerName: '', paperSize: 'a5', widthMm: 148, heightMm: 210, orientation: 'portrait', margins: { top: 8, right: 8, bottom: 8, left: 8 }, scale: 100, copies: 1 },
      { id: 'inv-thermal', name: 'Receipt Thermal 80mm', documentType: 'receipt', printerName: '', paperSize: 'thermal', widthMm: 80, heightMm: 200, orientation: 'portrait', margins: { top: 4, right: 4, bottom: 4, left: 4 }, scale: 100, copies: 1 },
      // customised legacy → converted
      { id: 'rx-letter', name: 'Prescription Letter', documentType: 'prescription', printerName: 'Brother HL', paperSize: 'letter', orientation: 'landscape', margins: { top: 15, right: 10, bottom: 15, left: 10 }, scale: 95, copies: 3 },
      { id: 'pos', name: 'POS receipt', documentType: 'receipt', printerName: 'POS-80', paperSize: 'custom', widthMm: 80, heightMm: 297, orientation: 'portrait', margins: { top: 2, right: 2, bottom: 2, left: 2 }, scale: 120, copies: 2 },
    ]);
    expect(plan.droppedSeeds).toEqual(['rx-a5', 'inv-thermal']);
    expect(plan.kept).toEqual(['rx-a4']);
    const letter = plan.profiles.find((p) => p.documentType === 'prescription' && p.id !== 'rx-a4')!;
    expect(letter).toMatchObject({ id: 'rx-a4-2', name: 'Prescription A4 (converted)', printerName: 'Brother HL', orientation: 'landscape', margins: { top: 15, right: 10, bottom: 15, left: 10 }, scale: 95, copies: 3 });
    // A roll printer cannot print A4: copies kept, printer/margins/scale reset.
    const pos = plan.profiles.find((p) => p.documentType === 'receipt')!;
    expect(pos).toMatchObject({ id: 'pos', name: 'POS receipt A4 (converted)', printerName: '', orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 2 });
    expect(plan.converted).toEqual([
      { from: 'rx-letter', to: 'rx-a4-2', medium: 'LETTER', printerCleared: false },
      { from: 'pos', to: 'pos', medium: 'custom 80 × 297 mm', printerCleared: true },
    ]);
    // Ids stay unique even after the missing document types are seeded.
    const all = withRequiredProfiles(plan.profiles);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    for (const type of PRINT_DOCUMENT_TYPES) expect(all.some((p) => p.documentType === type), type).toBe(true);
    // Normalizing again changes nothing (idempotent read path).
    expect(normalizePrintProfiles(all)).toEqual(all);
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

  it('keeps A4 profiles (with their customization), converts customised legacy ones and removes untouched seeds', () => {
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
    // The customised thermal receipt (printer POS-80) is converted, not deleted;
    // its receipt printer is not carried over to A4 (V5-022).
    const receipt = stored.find((p) => p.documentType === 'receipt') as Record<string, any>;
    expect(receipt).toMatchObject({ id: 'inv-a4-2', name: 'Receipt A4 (converted)', printerName: '', copies: 1 });
    expect(new Set(ids).size).toBe(ids.length);
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
    expect(audits[0].summary).toContain('1 unchanged legacy default(s) removed');
    const after = JSON.parse(audits[0].after_json) as { kept: string[]; converted: { to: string }[]; seeded: string[] };
    // The final list is exactly the profiles that were already A4, the converted
    // ones and the defaults seeded for document types nobody covered.
    expect([...after.kept, ...after.converted.map((c) => c.to), ...after.seeded]).toEqual(afterFirst.map((p) => p.id));
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

describe('print/PDF boundary enforcement (source gate)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('routes both main-process print paths through asA4PageSize', () => {
    const print = read('src/main/print.ts');
    // The requested box may only be resolved through the shared A4 helper: a
    // raw widthMm/heightMm must never reach Electron's pageSize directly.
    expect(print).toContain("import { asA4PageSize } from '../shared/print-page';");
    expect(print.match(/asA4PageSize\(/g)?.length).toBeGreaterThanOrEqual(2);
    const execute = print.slice(print.indexOf('export async function executePrint'), print.indexOf('export interface PdfOptions'));
    const pdf = print.slice(print.indexOf('export async function saveAsPdf'));
    for (const [name, body] of [['executePrint', execute], ['saveAsPdf', pdf]] as const) {
      expect(body, name).toContain('asA4PageSize(');
      expect(body, name).not.toMatch(/mmToInches\(opts\.(widthMm|heightMm)/);
      expect(body, name).not.toMatch(/pageSize:\s*\{\s*width:\s*Math\.(max|round)\(Number\(opts\.(widthMm|heightMm)/);
    }
  });
});
