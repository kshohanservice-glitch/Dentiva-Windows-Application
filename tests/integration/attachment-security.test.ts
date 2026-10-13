import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { addAttachment, attachmentPath, listAttachments, removeAttachment, renameAttachment } from '../../src/main/services/attachments';
import type { Ctx } from '../../src/main/core/context';
import type { PermissionKey } from '../../src/shared/permissions';

let env: TestEnv;
let source: string;
let ids: Record<string, number>;
const allow: Record<string, { read: PermissionKey; write: PermissionKey }> = {
  patient: { read: 'patients.view', write: 'patients.edit' },
  visit: { read: 'clinical.view', write: 'clinical.visit.edit' },
  staff: { read: 'staff.view', write: 'staff.manage' },
  invoice: { read: 'billing.invoice.view', write: 'billing.invoice.edit' },
  referral: { read: 'clinical.view', write: 'clinical.referral.manage' },
  prescription: { read: 'clinical.view', write: 'clinical.prescription.create' },
  appointment: { read: 'appointments.view', write: 'appointments.manage' },
};
const limited = (perms: PermissionKey[]): Ctx => ({ ...ownerCtx(env), session: sessionWith(perms) });

beforeEach(() => {
  env = createTestEnv('attachments-security');
  source = path.join(env.dir, 'note.txt');
  fs.writeFileSync(source, 'synthetic test attachment');
  const db = env.db;
  const now = new Date().toISOString();
  const pid = Number(db.prepare("INSERT INTO patients (code, name, gender, registration_date, created_at, updated_at) VALUES ('P-ATT', 'Attachment test', 'other', '2026-10-13', ?, ?)").run(now, now).lastInsertRowid);
  const dentist = Number(db.prepare('INSERT INTO dentists (name, active, created_at, updated_at) VALUES (?, 1, ?, ?)').run('Dr Fixture', now, now).lastInsertRowid);
  ids = { patient: pid };
  ids.staff = Number(db.prepare('INSERT INTO staff (name, created_at, updated_at) VALUES (?, ?, ?)').run('Staff Fixture', now, now).lastInsertRowid);
  ids.visit = Number(db.prepare('INSERT INTO visits (patient_id, datetime, created_by, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(pid, now, now, now).lastInsertRowid);
  ids.invoice = Number(db.prepare("INSERT INTO invoices (number, patient_id, date, created_by, created_at) VALUES ('INV-ATT', ?, '2026-10-13', 1, ?)").run(pid, now).lastInsertRowid);
  ids.referral = Number(db.prepare("INSERT INTO referrals (patient_id, direction, date, created_by, created_at) VALUES (?, 'out', '2026-10-13', 1, ?)").run(pid, now).lastInsertRowid);
  ids.prescription = Number(db.prepare("INSERT INTO prescriptions (number, patient_id, dentist_id, date, created_by, created_at) VALUES ('RX-ATT', ?, ?, '2026-10-13', 1, ?)").run(pid, dentist, now).lastInsertRowid);
  ids.appointment = Number(db.prepare("INSERT INTO appointments (patient_id, date, time, created_by, created_at, updated_at) VALUES (?, '2026-10-15', '10:00', 1, ?, ?)").run(pid, now, now).lastInsertRowid);
});
afterEach(() => cleanupEnv(env));

describe('attachment ownership and permission matrix', () => {
  it.each(Object.entries(allow))('%s: only the owning domain can read, add, rename and delete', (entity, perms) => {
    const id = ids[entity];
    const owner = ownerCtx(env);
    const added = addAttachment(owner, entity, id, source);
    const file = attachmentPath(owner, added.id).abs;
    const unrelated = limited(entity === 'patient' ? ['appointments.view', 'appointments.manage'] : ['patients.view', 'patients.edit']);
    expect(() => listAttachments(unrelated, entity, id)).toThrow(/permission/i);
    expect(() => attachmentPath(unrelated, added.id)).toThrow(/permission/i);
    expect(() => removeAttachment(unrelated, added.id)).toThrow(/permission/i);
    expect(() => renameAttachment(unrelated, added.id, 'stolen.txt')).toThrow(/permission/i);
    expect(() => addAttachment(unrelated, entity, id, source)).toThrow(/permission/i);
    const viewer = limited([perms.read]);
    expect(listAttachments(viewer, entity, id)).toHaveLength(1);
    expect(() => attachmentPath(viewer, added.id)).not.toThrow();
    expect(() => removeAttachment(viewer, added.id)).toThrow(/permission/i);
    const editor = limited([perms.read, perms.write]);
    expect(renameAttachment(editor, added.id, 'renamed.txt').originalName).toBe('renamed.txt');
    expect(removeAttachment(editor, added.id).ok).toBe(true);
    expect(listAttachments(viewer, entity, id)).toHaveLength(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('rejects symlink sources and storage paths escaping through symlinks', () => {
    const alias = path.join(env.dir, 'alias.txt');
    fs.symlinkSync(source, alias);
    expect(() => addAttachment(ownerCtx(env), 'patient', ids.patient, alias)).toThrow(/symbolic/i);
    const added = addAttachment(ownerCtx(env), 'patient', ids.patient, source);
    const stored = env.db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(added.id) as { stored_name: string };
    const abs = path.join(env.paths.attachmentsDir, stored.stored_name);
    const outside = path.join(env.dir, 'outside.txt');
    fs.writeFileSync(outside, 'private');
    fs.rmSync(abs);
    fs.symlinkSync(outside, abs);
    expect(() => attachmentPath(ownerCtx(env), added.id)).toThrow(/escapes/i);
    expect(() => removeAttachment(ownerCtx(env), added.id)).toThrow(/escapes/i);
    expect(fs.readFileSync(outside, 'utf8')).toBe('private');
  });

  it('cleans the copied file when metadata insert fails, preserving other attachments', () => {
    const first = addAttachment(ownerCtx(env), 'patient', ids.patient, source);
    const before = fs.readdirSync(path.join(env.paths.attachmentsDir, 'patient', String(ids.patient)));
    env.db.exec("CREATE TRIGGER reject_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'simulated insert failure'); END");
    expect(() => addAttachment(ownerCtx(env), 'patient', ids.patient, source)).toThrow(/simulated insert failure/);
    const after = fs.readdirSync(path.join(env.paths.attachmentsDir, 'patient', String(ids.patient)));
    expect(after).toEqual(before);
    expect(attachmentPath(ownerCtx(env), first.id)).toBeDefined();
    expect((env.db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n).toBe(1);
  });

  it('restores the original file and metadata if deletion fails in the database', () => {
    const owner = ownerCtx(env);
    const added = addAttachment(owner, 'patient', ids.patient, source);
    const originalPath = attachmentPath(owner, added.id).abs;
    env.db.exec("CREATE TRIGGER reject_attachment_delete BEFORE DELETE ON attachments BEGIN SELECT RAISE(ABORT, 'simulated delete failure'); END");
    expect(() => removeAttachment(owner, added.id)).toThrow(/simulated delete failure/);
    expect(fs.readFileSync(originalPath, 'utf8')).toBe('synthetic test attachment');
    expect(attachmentPath(owner, added.id).abs).toBe(originalPath);
    expect(listAttachments(owner, 'patient', ids.patient)).toHaveLength(1);
  });

  it('rejects stored traversal even when database metadata was tampered with', () => {
    const added = addAttachment(ownerCtx(env), 'patient', ids.patient, source);
    env.db.prepare('UPDATE attachments SET stored_name = ? WHERE id = ?').run('../outside.txt', added.id);
    expect(() => attachmentPath(ownerCtx(env), added.id)).toThrow(/path/i);
    expect(() => removeAttachment(ownerCtx(env), added.id)).toThrow(/path/i);
  });
});

