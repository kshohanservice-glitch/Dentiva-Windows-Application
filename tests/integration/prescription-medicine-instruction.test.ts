import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { createPatient } from '../../src/main/services/patients';
import { createPrescription, listTemplates } from '../../src/main/services/prescriptions';
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
