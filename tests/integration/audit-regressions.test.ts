/**
 * V1.1 audit regression tests.
 * Each case locks a defect found by the independent audit (docs/V1.1_ISSUE_REGISTER.md):
 * ISS-008 refund bound · ISS-009 CSV formula injection · ISS-010 owner protection ·
 * ISS-011 failed-unlock audit · ISS-012 backup list truthfulness · ISS-013 date
 * validation · ISS-016 queue/appointment sync · ISS-017 no-show guard ·
 * ISS-018 attachment write permissions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { createPatient } from '../../src/main/services/patients';
import { createInvoice, createPayment, getInvoice, paidNetFor } from '../../src/main/services/billing';
import { patientCsvRows } from '../../src/main/services/patients';
import { toCsv, neutralizeFormula } from '../../src/shared/csv';
import { saveUser } from '../../src/main/services/users';
import { addAttachment, listAttachments } from '../../src/main/services/attachments';
import { createAppointment, updateAppointment, markNoShow, cancelAppointment, arriveAppointment } from '../../src/main/services/appointments';
import { performQueueAction } from '../../src/main/services/queue';
import { createVisit } from '../../src/main/services/visits';
import { createPrescription } from '../../src/main/services/prescriptions';
import { createBackupService } from '../../src/main/services/backup';
import { SessionManager } from '../../src/main/core/session';
import { hashPassword } from '../../src/main/core/passwords';
import type { Ctx } from '../../src/main/core/context';
import { ALL_PERMISSIONS } from '../../src/shared/permissions';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('audit-regressions');
});

afterEach(() => {
  cleanupEnv(env);
});

function patient(ctx: Ctx, phone: string) {
  return createPatient(ctx, { name: 'Regression Patient', gender: 'female', ageYears: 29, phone, forceCreate: true });
}

function seedDentist(): number {
  const now = new Date().toISOString();
  const info = env.db
    .prepare("INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Regression', NULL, 1, ?, ?)")
    .run(now, now);
  return Number(info.lastInsertRowid);
}

describe('ISS-008 financial integrity: refund bound', () => {
  it('rejects a refund larger than net paid; Total = Paid + Due holds', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000101');
    const inv = createInvoice(ctx, {
      patientId: p.id, date: '2026-09-28',
      items: [{ description: 'Consultation', qty: 1, unitPricePaisa: 100000 }],
    });
    createPayment(ctx, { invoiceId: inv.id, patientId: p.id, amountPaisa: 100000, method: 'cash' });
    expect(() =>
      createPayment(ctx, { invoiceId: inv.id, patientId: p.id, amountPaisa: 150000, method: 'cash', type: 'refund' }),
    ).toThrow(/refund exceeds/i);
    // Net unchanged, invariant holds
    expect(paidNetFor(ctx.db, inv.id)).toBe(100000);
    const after = getInvoice(ctx, inv.id);
    expect(after.paidPaisa + after.duePaisa).toBe(after.totalPaisa);
  });

  it('allows a partial refund within net paid', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000111');
    const inv = createInvoice(ctx, {
      patientId: p.id, date: '2026-09-28',
      items: [{ description: 'Filling', qty: 1, unitPricePaisa: 80000 }],
    });
    createPayment(ctx, { invoiceId: inv.id, patientId: p.id, amountPaisa: 80000, method: 'bkash' });
    createPayment(ctx, { invoiceId: inv.id, patientId: p.id, amountPaisa: 30000, method: 'bkash', type: 'refund' });
    const after = getInvoice(ctx, inv.id);
    expect(after.paidPaisa + after.duePaisa).toBe(after.totalPaisa);
    expect(after.duePaisa).toBe(30000);
  });
});

describe('ISS-009 CSV formula injection defense', () => {
  it('neutralizes formula-leading cells but keeps numbers intact', () => {
    const csv = toCsv(
      ['name', 'address', 'age'],
      [
        ['=cmd|calc!A0', '+62-555', '25'],
        ['@SUM(A1:A9)', '-5', 'normal text'],
        ['"quoted=cell"', '=1+2', '-3.5'],
      ],
    );
    expect(csv).toContain("'=cmd|calc!A0");
    expect(csv).toContain("'+62-555");
    expect(csv).toContain("'@SUM(A1:A9)");
    expect(csv).toContain("'=1+2");
    expect(csv).toContain('25'); // numeric untouched
    expect(csv).toContain('-5'); // numeric negative untouched
    expect(csv).toContain('-3.5');
    expect(csv).toContain('"\'quoted=cell"'.replace("'", '')); // quoting still applied after prefixing
    // No raw formula at start of any cell
    for (const cell of csv.replace(/\r\n/g, '\n').split(/\n|,/)) {
      const t = cell.replace(/^"|"$/g, '');
      if (t && /[=+@]/.test(t.charAt(0)) && !/^-?\d/.test(t)) expect(t.charAt(0)).toBe("'");
    }
  });

  it('patient export rows are safe when serialized', () => {
    const ctx = ownerCtx(env);
    createPatient(ctx, { name: '=cmd|calc!A0', bengaliName: '+62-555', gender: 'male', ageYears: 25, address: '@SUM(A1)', phone: '01700000102', forceCreate: true });
    const { header, rows } = patientCsvRows(ctx, {});
    const csv = toCsv(header, rows);
    expect(csv).not.toMatch(/(^|[,\r\n])=cmd/);
    expect(csv).not.toMatch(/(^|[,\r\n])\+62/);
    expect(csv).not.toMatch(/(^|[,\r\n])@SUM/);
    expect(neutralizeFormula('=X')).toBe("'=X");
    expect(neutralizeFormula(42)).toBe('42');
  });
});

describe('ISS-010 owner account protection', () => {
  function adminCtx(): Ctx {
    const role = env.db.prepare("SELECT id FROM roles WHERE key = 'administrator'").get<{ id: number }>()!;
    const now = new Date().toISOString();
    env.db
      .prepare("INSERT INTO users (username, display_name, password_hash, role_id, status, created_at, updated_at) VALUES ('admin', 'Admin', 'x', ?, 'active', ?, ?)")
      .run(role.id, now, now);
    const adminId = Number(env.db.prepare("SELECT id FROM users WHERE username = 'admin'").get<{ id: number }>()!.id);
    return {
      db: env.db, paths: env.paths,
      session: sessionWith([...ALL_PERMISSIONS], { roleKey: 'administrator', userId: adminId, username: 'admin' }),
    };
  }

  it('non-owner cannot demote/disable the owner user', async () => {
    const ctx = adminCtx();
    const reception = env.db.prepare("SELECT id FROM roles WHERE key = 'receptionist'").get<{ id: number }>()!;
    await expect(
      saveUser(ctx, { id: 1, username: 'owner', displayName: 'Test Owner', roleId: reception.id, status: 'disabled' }),
    ).rejects.toThrow(/only the owner/i);
  });

  it('non-owner cannot assign the owner role to another user', async () => {
    const ctx = adminCtx();
    const ownerRole = env.db.prepare("SELECT id FROM roles WHERE key = 'owner'").get<{ id: number }>()!;
    await expect(
      saveUser(ctx, { username: 'sockpuppet', displayName: 'Sock', roleId: ownerRole.id, password: 'abc12345' }),
    ).rejects.toThrow(/only the owner/i);
  });

  it('owner can still manage owner accounts', async () => {
    const ctx = ownerCtx(env);
    const reception = env.db.prepare("SELECT id FROM roles WHERE key = 'receptionist'").get<{ id: number }>()!;
    const dto = await saveUser(ctx, { id: 1, username: 'owner', displayName: 'Owner Renamed', roleId: reception.id, status: 'active' });
    expect(dto.displayName).toBe('Owner Renamed');
  });
});

describe('ISS-011 failed unlock is audited', () => {
  it('records a denied audit entry on wrong password at the lock screen', async () => {
    const hash = await hashPassword('goodPass123');
    env.db.prepare("UPDATE users SET password_hash = ? WHERE id = 1").run(hash);
    const mgr = new SessionManager({
      db: () => env.db,
      securityPolicy: () => ({ maxFailedLogins: 5, minPasswordLength: 8 }),
      onLock: () => {},
    });
    const res = await mgr.signIn('owner', 'goodPass123');
    expect(res.ok).toBe(true);
    mgr.lock();
    expect(await mgr.unlock('wrongPass999')).toBe(false);
    const row = env.db
      .prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'auth.unlock' AND result = 'denied'")
      .get<{ c: number }>()!;
    expect(Number(row.c)).toBe(1);
    expect(await mgr.unlock('goodPass123')).toBe(true);
  });
});

describe('ISS-012 backup list truthfulness', () => {
  it('flags backups whose file disappeared from disk', async () => {
    const ctx = ownerCtx(env);
    const svc = createBackupService({
      paths: env.paths,
      holder: { get: () => env.db, set: () => {} },
      appVersion: 'test',
      notify: () => {},
    });
    const dest = path.join(env.dir, 'bk');
    fs.mkdirSync(dest, { recursive: true });
    const rec = await svc.runBackup(ctx, dest, 'manual');
    expect(rec.status).toBe('ok');
    fs.rmSync(rec.path, { force: true });
    const list = svc.listBackups(ctx);
    const entry = list.find((b) => b.id === rec.id)!;
    expect(entry.status).toBe('missing');
  });
});

describe('ISS-013 date validation', () => {
  it('rejects impossible payment dates (not just non-dates)', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000103');
    const inv = createInvoice(ctx, {
      patientId: p.id, date: '2026-09-28',
      items: [{ description: 'X', qty: 1, unitPricePaisa: 10000 }],
    });
    expect(() =>
      createPayment(ctx, { invoiceId: inv.id, patientId: p.id, amountPaisa: 10000, method: 'cash', paidAt: '2026-99-99' }),
    ).toThrow(/valid (calendar )?date/i);
  });

  it('rejects impossible visit datetimes', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000104');
    expect(() => createVisit(ctx, { patientId: p.id, datetime: '2026-09-28T99:99' })).toThrow(/valid (calendar )?date( and time)?/i);
    expect(() => createVisit(ctx, { patientId: p.id, datetime: '2026-13-45T10:00' })).toThrow(/valid (calendar )?date/i);
  });

  it('rejects impossible prescription dates', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000105');
    const d = seedDentist();
    expect(() =>
      createPrescription(ctx, { patientId: p.id, dentistId: d, date: '2026-02-31', items: [{ medicineName: 'Amoxicillin' }] }),
    ).toThrow(/valid (calendar )?date/i);
  });
});

describe('ISS-016/017 appointment state consistency', () => {
  it('cancelling a queued patient also cancels the linked appointment', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000106');
    const d = seedDentist();
    const appt = createAppointment(ctx, {
      patientId: p.id, dentistId: d, date: '2026-09-28', time: '10:00',
      durationMin: 15, type: 'checkup', status: 'scheduled',
    });
    const arrived = arriveAppointment(ctx, appt.id);
    expect(arrived.appointment.status).toBe('in_queue');
    performQueueAction(ctx, arrived.queue.id, 'cancel');
    const row = env.db.prepare('SELECT status FROM appointments WHERE id = ?').get(appt.id) as { status: string };
    expect(row.status).toBe('cancelled');
  });

  it('completed appointments cannot be marked no-show', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000107');
    const d = seedDentist();
    const appt = createAppointment(ctx, {
      patientId: p.id, dentistId: d, date: '2026-09-28', time: '11:00',
      durationMin: 15, type: 'checkup', status: 'scheduled',
    });
    updateAppointment(ctx, appt.id, { status: 'completed' });
    expect(() => markNoShow(ctx, appt.id)).toThrow(/cannot mark/i);
    expect(() => cancelAppointment(ctx, appt.id)).toThrow(/cannot be cancelled/i);
  });
});

describe('ISS-018 attachment write permissions', () => {
  function pngFixture(): string {
    const p = path.join(env.dir, 'fixture.png');
    fs.writeFileSync(p, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('audit-test')]));
    return p;
  }

  it('read-only users cannot add attachments', () => {
    const owner = ownerCtx(env);
    const p = patient(owner, '01700000108');
    const reader = { db: env.db, paths: env.paths, session: sessionWith(['patients.view']) };
    expect(() => addAttachment(reader, 'patient', p.id, pngFixture())).toThrow(/permission/i);
    expect(listAttachments(reader, 'patient', p.id)).toEqual([]);
  });

  it('users with patients.edit can add and then list attachments', () => {
    const owner = ownerCtx(env);
    const p = patient(owner, '01700000109');
    const editor = { db: env.db, paths: env.paths, session: sessionWith(['patients.view', 'patients.edit']) };
    const att = addAttachment(editor, 'patient', p.id, pngFixture());
    expect(att.originalName).toBe('fixture.png');
    expect(listAttachments(editor, 'patient', p.id).length).toBe(1);
  });
});
