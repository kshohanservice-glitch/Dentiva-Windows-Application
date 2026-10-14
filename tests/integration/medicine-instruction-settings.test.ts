/**
 * Service-level regression tests for the v4.1.3 prescription/print settings.
 *
 * Three data-safety properties are protected here:
 *
 *   1. `prescriptions.medicine_instruction` is **additive** — a prescription
 *      written without it reads back as `null`, and the structured medicine
 *      rows (`prescription_items`) are stored exactly as before;
 *   2. the printed prescription labels are always complete, so a legacy
 *      settings row (written before the medicine-instruction label existed)
 *      upgrades to a full label set instead of printing a blank heading;
 *   3. the clinic-logo watermark is validated on both read and write, so a
 *      hand-edited or half-written settings row can never reach a document with
 *      an out-of-range size, an out-of-range opacity or a non-boolean switch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { createPrescription, getPrescription } from '../../src/main/services/prescriptions';
import { getSettings, saveSettings } from '../../src/main/services/settings';
import { createPatient } from '../../src/main/services/patients';
import { MEDICINE_INSTRUCTION_MAX, PRESCRIPTION_LABEL_DEFAULTS } from '../../src/shared/clinical';
import { WATERMARK_DEFAULT } from '../../src/shared/watermark';

let env: TestEnv;
beforeEach(() => { env = createTestEnv('medicine-instruction'); });
afterEach(() => cleanupEnv(env));

function patientAndDentist(): { patientId: number; dentistId: number } {
  const ctx = ownerCtx(env);
  const patient = createPatient(ctx, { name: 'Instruction Tester', gender: 'female', ageYears: 30, phone: '01733330001' });
  const now = new Date().toISOString();
  const dentistId = Number(env.db
    .prepare("INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Instruction', NULL, 1, ?, ?)")
    .run(now, now).lastInsertRowid);
  return { patientId: patient.id, dentistId };
}

describe('prescriptions.medicine_instruction', () => {
  it('stores and returns the optional single-line instruction', () => {
    const ctx = ownerCtx(env);
    const { patientId, dentistId } = patientAndDentist();
    const line = 'Tab.Napa - 100MG - 1+0+1/ or 2 Times -1 Tab - 7 Days - After Meals';
    const rx = createPrescription(ctx, {
      patientId, dentistId, date: '2026-10-14',
      medicineInstruction: `  ${line}  `,
      items: [{ medicineName: 'Amoxicillin', dosage: '1 capsule', timing: 'after' }],
    });
    expect(rx.medicineInstruction).toBe(line);
    expect(getPrescription(ctx, rx.id).medicineInstruction).toBe(line);

    // Stored as its own column, and the structured rows are untouched.
    const row = env.db.prepare('SELECT medicine_instruction FROM prescriptions WHERE id = ?').get<{ medicine_instruction: string | null }>(rx.id);
    expect(row!.medicine_instruction).toBe(line);
    const item = env.db.prepare('SELECT medicine_name, dosage, timing FROM prescription_items WHERE prescription_id = ?').all(rx.id);
    expect(item).toEqual([{ medicine_name: 'Amoxicillin', dosage: '1 capsule', timing: 'after' }]);
  });

  it('leaves every prescription written before v4.1.3 with a null instruction', () => {
    const ctx = ownerCtx(env);
    const { patientId, dentistId } = patientAndDentist();
    const rx = createPrescription(ctx, {
      patientId, dentistId, date: '2026-10-14',
      items: [{ medicineName: 'Ibuprofen' }],
    });
    expect(rx.medicineInstruction).toBeNull();
    expect(getPrescription(ctx, rx.id).medicineInstruction).toBeNull();
    // An explicitly blank value is not stored as an empty string either.
    const blank = createPrescription(ctx, {
      patientId, dentistId, date: '2026-10-14', medicineInstruction: '   ',
      items: [{ medicineName: 'Paracetamol' }],
    });
    expect(blank.medicineInstruction).toBeNull();
  });

  it(`rejects an instruction longer than ${MEDICINE_INSTRUCTION_MAX} characters and stores nothing`, () => {
    const ctx = ownerCtx(env);
    const { patientId, dentistId } = patientAndDentist();
    const before = Number(env.db.prepare('SELECT COUNT(*) AS n FROM prescriptions').get<{ n: number }>()!.n);
    expect(() => createPrescription(ctx, {
      patientId, dentistId, date: '2026-10-14',
      medicineInstruction: 'x'.repeat(MEDICINE_INSTRUCTION_MAX + 1),
      items: [{ medicineName: 'Amoxicillin' }],
    })).toThrow(/too long/i);
    // The rejected call must not leave a half-written prescription behind.
    expect(Number(env.db.prepare('SELECT COUNT(*) AS n FROM prescriptions').get<{ n: number }>()!.n)).toBe(before);
  });

  it('requires the permission that already guards prescription creation', () => {
    const { patientId, dentistId } = patientAndDentist();
    const readOnly = { ...ownerCtx(env), session: sessionWith(['clinical.view']) };
    expect(() => createPrescription(readOnly, {
      patientId, dentistId, date: '2026-10-14',
      medicineInstruction: 'Tab.Napa 1+0+1',
      items: [{ medicineName: 'Amoxicillin' }],
    })).toThrow(/permission/i);
  });
});

describe('printed prescription labels in settings', () => {
  it('returns a complete label set for an installation that never configured any', () => {
    const ctx = ownerCtx(env);
    expect(getSettings(ctx).prescription.labels).toEqual(PRESCRIPTION_LABEL_DEFAULTS);
  });

  it('upgrades a legacy row that stored only the seven original labels', () => {
    const ctx = ownerCtx(env);
    // Exactly what v4.1.2 wrote.
    env.db.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run('prescription', JSON.stringify({
        labels: {
          cc: 'C/C', oe: 'O/E', re: 'R/E', diagnosis: 'Diagnosis',
          treatment: 'Treatment', advice: 'Advice', followUp: 'Follow-up',
        },
      }), new Date().toISOString());
    const labels = getSettings(ctx).prescription.labels;
    expect(labels.cc).toBe('C/C');
    expect(labels.medicineInstruction).toBe('Medicine Instruction');
  });

  it('saves renamed labels, refuses blank ones, and keeps unrelated labels', () => {
    const ctx = ownerCtx(env);
    const saved = saveSettings(ctx, { prescription: { labels: { cc: '  Complaint  ' } } } as any);
    expect(saved.prescription.labels.cc).toBe('Complaint');
    expect(saved.prescription.labels.medicineInstruction).toBe('Medicine Instruction');
    expect(() => saveSettings(ctx, { prescription: { labels: { cc: '   ' } } } as any)).toThrow();
    expect(() => saveSettings(ctx, { prescription: { labels: { cc: 'y'.repeat(61) } } } as any)).toThrow();
    // The rejected write changed nothing.
    expect(getSettings(ctx).prescription.labels.cc).toBe('Complaint');
  });
});

describe('clinic-logo watermark in settings', () => {
  it('is disabled by default and survives a save/read round trip', () => {
    const ctx = ownerCtx(env);
    expect(getSettings(ctx).watermark).toEqual(WATERMARK_DEFAULT);

    const saved = saveSettings(ctx, { watermark: { enabled: true, sizePercent: 70, opacity: 0.12 } } as any);
    expect(saved.watermark).toEqual({ enabled: true, sizePercent: 70, opacity: 0.12 });
    expect(getSettings(ctx).watermark).toEqual({ enabled: true, sizePercent: 70, opacity: 0.12 });
  });

  it('clamps out-of-range values instead of writing them to disk', () => {
    const ctx = ownerCtx(env);
    saveSettings(ctx, { watermark: { enabled: true, sizePercent: 5000, opacity: 99 } } as any);
    const stored = env.db.prepare("SELECT value_json FROM settings WHERE key = 'watermark'").get<{ value_json: string }>();
    const parsed = JSON.parse(stored!.value_json);
    expect(parsed.sizePercent).toBe(100);
    expect(parsed.opacity).toBe(0.5);
  });

  it('degrades a hand-edited or corrupt row to the safe default on read', () => {
    const ctx = ownerCtx(env);
    env.db.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run('watermark', '{not json', new Date().toISOString());
    expect(getSettings(ctx).watermark).toEqual(WATERMARK_DEFAULT);
    env.db.prepare("UPDATE settings SET value_json = ? WHERE key = 'watermark'")
      .run(JSON.stringify({ enabled: 'yes', sizePercent: 'big', opacity: null }));
    expect(getSettings(ctx).watermark).toEqual(WATERMARK_DEFAULT);
  });
});
