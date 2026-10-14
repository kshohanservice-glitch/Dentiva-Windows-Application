import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { createPatient } from '../../src/main/services/patients';
import { createPrescription, getPrescription, listTemplates } from '../../src/main/services/prescriptions';
import { getSettings, saveSettings } from '../../src/main/services/settings';
import { DEFAULT_DOCUMENT_WATERMARK } from '../../src/shared/document-watermark';
import { openDatabase, schemaVersionOf } from '../../src/main/db/database';
import { MIGRATIONS } from '../../src/main/db/migrations';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('prescription-medicine-instruction');
});

afterEach(() => cleanupEnv(env));

describe('optional one-line medicine instruction', () => {
  it('stores exact nonblank text and carries it into medicine templates', () => {
    const ctx = ownerCtx(env);
    const patient = createPatient(ctx, {
      name: 'Instruction Test Patient', gender: 'female', ageYears: 35,
      phone: '01722223333', forceCreate: true,
    });
    const now = new Date().toISOString();
    const dentistId = Number(env.db.prepare(
      "INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Instruction', NULL, 1, ?, ?)"
    ).run(now, now).lastInsertRowid);
    const instruction = '  Take one tablet after meals for three days.  ';

    const rx = createPrescription(ctx, {
      patientId: patient.id,
      dentistId,
      date: '2026-10-14',
      saveAsTemplate: 'One-line instruction template',
      items: [{ medicineName: 'Example medicine', dosage: '1 tablet', frequency: '3× daily', medicineInstruction: instruction }],
    } as any);

    expect(rx.items[0].medicineInstruction).toBe(instruction);
    expect(rx.items[0].dosage).toBe('1 tablet');
    expect(rx.items[0].frequency).toBe('3× daily');
    expect(listTemplates(ctx).find((template) => template.name === 'One-line instruction template')?.items[0].medicineInstruction).toBe(instruction);
  });

  it('adds the column to a v6-shaped database without changing existing prescription data', () => {
    const ctx = ownerCtx(env);
    const patient = createPatient(ctx, {
      name: 'Legacy Prescription Patient', gender: 'other', ageYears: 42,
      phone: '01733334444', forceCreate: true,
    });
    const now = new Date().toISOString();
    const dentistId = Number(env.db.prepare(
      "INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Legacy', NULL, 1, ?, ?)"
    ).run(now, now).lastInsertRowid);
    const rxId = Number(env.db.prepare(
      `INSERT INTO prescriptions (number, patient_id, dentist_id, date, c_c, created_by, created_at)
       VALUES ('RX-2026-00001', ?, ?, '2026-10-13', 'Existing complaint', 1, ?)`
    ).run(patient.id, dentistId, now).lastInsertRowid);
    env.db.prepare(
      `INSERT INTO prescription_items (prescription_id, seq, medicine_name, dosage, frequency, instruction)
       VALUES (?, 1, 'Legacy medicine', 'one dose', 'daily', 'existing note')`
    ).run(rxId);

    // Recreate the pre-007 schema, then exercise the same upgrade path that an
    // installed v6 database takes on its next normal open.
    env.db.exec('ALTER TABLE prescription_items DROP COLUMN medicine_instruction');
    env.db.pragma('user_version = 6');
    env.db.close();
    env.db = openDatabase(env.paths.dbFile, { runMigrations: true }).db;

    expect(schemaVersionOf(env.db)).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
    const columns = (env.db.prepare('PRAGMA table_info(prescription_items)').all() as { name: string }[]).map((column) => column.name);
    expect(columns).toContain('medicine_instruction');
    const row = env.db.prepare(
      'SELECT medicine_name, dosage, frequency, instruction, medicine_instruction FROM prescription_items WHERE prescription_id = ?'
    ).get(rxId) as Record<string, string | null>;
    expect(row).toEqual({
      medicine_name: 'Legacy medicine', dosage: 'one dose', frequency: 'daily',
      instruction: 'existing note', medicine_instruction: null,
    });
  });
});

function seedPatient(env: TestEnv, name: string): { patientId: number; dentistId: number } {
  const ctx = ownerCtx(env);
  const patient = createPatient(ctx, { name, gender: 'male', ageYears: 30, phone: '01744445555', forceCreate: true });
  const now = new Date().toISOString();
  const dentistId = Number(env.db.prepare(
    "INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Verbatim', NULL, 1, ?, ?)"
  ).run(now, now).lastInsertRowid);
  return { patientId: patient.id, dentistId };
}

describe('one-line medicine instruction service rules', () => {
  it('stores blank, missing and whitespace-only instructions as null', () => {
    const ctx = ownerCtx(env);
    const { patientId, dentistId } = seedPatient(env, 'Null Instruction Patient');
    for (const value of [undefined, null, '', '   ']) {
      const rx = createPrescription(ctx, {
        patientId, dentistId, date: '2026-10-14',
        items: [{ medicineName: `Medicine ${String(value)}`, dosage: '1 tablet', medicineInstruction: value }],
      } as any);
      expect(getPrescription(ctx, rx.id).items[0].medicineInstruction, String(value)).toBeNull();
    }
  });

  it('rejects an over-long instruction without writing a prescription row', () => {
    const ctx = ownerCtx(env);
    const { patientId, dentistId } = seedPatient(env, 'Too Long Instruction Patient');
    const before = Number((env.db.prepare('SELECT COUNT(*) n FROM prescriptions').get() as { n: number }).n);
    expect(() => createPrescription(ctx, {
      patientId, dentistId, date: '2026-10-14',
      items: [{ medicineName: 'Amoxicillin', medicineInstruction: 'x'.repeat(501) }],
    } as any)).toThrow(/too long/i);
    const after = Number((env.db.prepare('SELECT COUNT(*) n FROM prescriptions').get() as { n: number }).n);
    expect(after).toBe(before);
  });

  it('requires prescription-create permission and writes nothing without it', () => {
    const { patientId, dentistId } = seedPatient(env, 'Permission Instruction Patient');
    const viewOnly = { db: env.db, paths: env.paths, session: sessionWith(['patients.view']) } as TestEnv['db'] extends never ? never : any;
    const before = Number((env.db.prepare('SELECT COUNT(*) n FROM prescriptions').get() as { n: number }).n);
    expect(() => createPrescription(viewOnly, {
      patientId, dentistId, date: '2026-10-14',
      items: [{ medicineName: 'Amoxicillin', medicineInstruction: 'After meals' }],
    } as any)).toThrow(/permission/i);
    expect(Number((env.db.prepare('SELECT COUNT(*) n FROM prescriptions').get() as { n: number }).n)).toBe(before);
  });

  it('keeps the one-line text verbatim while structured dosing keeps its own column', () => {
    const ctx = ownerCtx(env);
    const { patientId, dentistId } = seedPatient(env, 'Verbatim Instruction Patient');
    const instruction = '  Tab.Napa - 100MG - 1+0+1/ or 2 Times -1 Tab - 7 Days - After Meals  ';
    const rx = createPrescription(ctx, {
      patientId, dentistId, date: '2026-10-14',
      items: [{ medicineName: 'Napa', strength: '100MG', dosage: '1 tablet', frequency: '1+0+1', duration: '7 days', instruction: 'after meals', medicineInstruction: instruction }],
    } as any);
    const dto = getPrescription(ctx, rx.id).items[0];
    expect(dto.medicineInstruction).toBe(instruction);
    expect([dto.dosage, dto.frequency, dto.duration, dto.instruction]).toEqual(['1 tablet', '1+0+1', '7 days', 'after meals']);
    const row = env.db.prepare(
      'SELECT medicine_instruction, dosage, frequency, duration, instruction FROM prescription_items WHERE id = ?'
    ).get(dto.id) as Record<string, string>;
    // The free-text line is never merged into, or derived from, the structured columns.
    expect(row.medicine_instruction).toBe(instruction);
    expect(row.dosage).toBe('1 tablet');
    expect(row.frequency).toBe('1+0+1');
    expect(row.duration).toBe('7 days');
    expect(row.instruction).toBe('after meals');
  });
});

describe('clinic-logo watermark settings', () => {
  it('ships disabled, so existing installations print exactly as before', () => {
    const ctx = ownerCtx(env);
    expect(getSettings(ctx).documentWatermark).toEqual({ ...DEFAULT_DOCUMENT_WATERMARK });
  });

  it('round-trips a configured watermark and survives a reopen of the database', () => {
    const ctx = ownerCtx(env);
    saveSettings(ctx, { documentWatermark: { enabled: true, sizePercent: 70, opacity: 0.12 } });
    expect(getSettings(ctx).documentWatermark).toEqual({ enabled: true, sizePercent: 70, opacity: 0.12 });
    const stored = env.db.prepare("SELECT value_json FROM settings WHERE key = 'documentWatermark'").get() as { value_json: string };
    expect(JSON.parse(stored.value_json)).toEqual({ enabled: true, sizePercent: 70, opacity: 0.12 });
  });

  it('clamps out-of-range values to the supported window', () => {
    const ctx = ownerCtx(env);
    const saved = saveSettings(ctx, { documentWatermark: { enabled: true, sizePercent: 500, opacity: 9 } });
    expect(saved.documentWatermark).toEqual({ enabled: true, sizePercent: 70, opacity: 0.3 });
    expect(getSettings(ctx).documentWatermark).toEqual({ enabled: true, sizePercent: 70, opacity: 0.3 });
  });

  it('falls back to the default for hand-edited or corrupt stored JSON', () => {
    const ctx = ownerCtx(env);
    const write = (value: string) => env.db.prepare(
      "INSERT INTO settings (key, value_json, updated_at) VALUES ('documentWatermark', ?, ?)\n       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
    ).run(value, new Date().toISOString());
    write('{not json');
    expect(getSettings(ctx).documentWatermark).toEqual({ ...DEFAULT_DOCUMENT_WATERMARK });
    write(JSON.stringify({ enabled: 'yes', sizePercent: 'big', opacity: null }));
    expect(getSettings(ctx).documentWatermark).toEqual({ ...DEFAULT_DOCUMENT_WATERMARK });
    write(JSON.stringify({ enabled: true, sizePercent: 30, opacity: 0.1 }));
    expect(getSettings(ctx).documentWatermark).toEqual({ enabled: true, sizePercent: 30, opacity: 0.1 });
  });

  it('does not disturb the other customization settings when the watermark changes', () => {
    const ctx = ownerCtx(env);
    const before = getSettings(ctx);
    saveSettings(ctx, { documentWatermark: { enabled: true, sizePercent: 25, opacity: 0.2 } });
    const after = getSettings(ctx);
    expect(after.documentStyles).toEqual(before.documentStyles);
    expect(after.printProfiles).toEqual(before.printProfiles);
    expect(after.prescription).toEqual(before.prescription);
  });
});
