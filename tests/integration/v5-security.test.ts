/**
 * v5 Phase 2 — security and data-safety regressions.
 *
 * Each block names the issue-register entry it guards (docs/audits/v5/ISSUE_REGISTER.md).
 * Tests drive the real service layer against disposable migrated SQLite databases.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import type { Ctx } from '../../src/main/core/context';
import { AppError } from '../../src/main/errors';
import { SessionManager } from '../../src/main/core/session';
import { hashPassword } from '../../src/main/core/passwords';
import { deleteUser, listUsers, resetPassword, saveRole, saveUser } from '../../src/main/services/users';
import { loadPermissions } from '../../src/main/services/auth';
import { createBackupService } from '../../src/main/services/backup';
import { getSettings, resolveManagedLogoPath, saveSettings } from '../../src/main/services/settings';
import { openDatabase, PRE_MIGRATION_DIR, PRE_MIGRATION_KEEP } from '../../src/main/db/database';
import { createPatient } from '../../src/main/services/patients';
import { createVisit } from '../../src/main/services/visits';
import { createInvoice } from '../../src/main/services/billing';
import { createPrescription, deleteTemplate, saveTemplate } from '../../src/main/services/prescriptions';
import { setChart } from '../../src/main/services/chart';
import { BUILTIN_ROLES, type PermissionKey } from '../../src/shared/permissions';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('v5-security');
});

afterEach(() => {
  cleanupEnv(env);
});

function roleId(key: string): number {
  return env.db.prepare('SELECT id FROM roles WHERE key = ?').get<{ id: number }>(key)!.id;
}

async function addUser(username: string, roleKey: string, password = 'goodPass123'): Promise<number> {
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  return Number(env.db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(username, username, hash, roleId(roleKey), now, now).lastInsertRowid);
}

function ctxFor(userId: number, roleKey: string, permissions: PermissionKey[]): Ctx {
  return { db: env.db, paths: env.paths, session: sessionWith(permissions, { userId, roleKey, username: `user${userId}` }) };
}

function managerFor(maxFailedLogins = 3): SessionManager {
  return new SessionManager({
    db: () => env.db,
    securityPolicy: () => ({ maxFailedLogins, minPasswordLength: 8 }),
    onLock: () => {},
  });
}

async function expectAppError(p: Promise<unknown> | (() => unknown), code: string, message?: RegExp): Promise<void> {
  try {
    if (typeof p === 'function') p(); else await p;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    if (message) expect((err as AppError).userMessage).toMatch(message);
    return;
  }
  throw new Error(`expected AppError ${code}`);
}

describe('V5-001 lock-screen brute-force limit', () => {
  it('ends the session and locks the account after maxFailedLogins wrong unlock passwords', async () => {
    const id = await addUser('nurse', 'assistant');
    const mgr = managerFor(3);
    expect((await mgr.signIn('nurse', 'goodPass123')).ok).toBe(true);
    mgr.lock();
    expect(await mgr.unlock('wrong-1')).toEqual({ ok: false, error: 'Incorrect password.', attemptsLeft: 2 });
    expect(await mgr.unlock('wrong-2')).toEqual({ ok: false, error: 'Incorrect password.', attemptsLeft: 1 });
    await expectAppError(mgr.unlock('wrong-3'), 'AUTH', /signed out/i);
    expect(mgr.current()).toBeNull();
    expect(() => mgr.require()).toThrow(/sign in/i);
    const row = env.db.prepare('SELECT locked_until FROM users WHERE id = ?').get<{ locked_until: string | null }>(id)!;
    expect(row.locked_until).not.toBeNull();
    expect(new Date(row.locked_until!).getTime()).toBeGreaterThan(Date.now());
    // The lockout carries over to the sign-in screen.
    const relogin = await mgr.signIn('nurse', 'goodPass123');
    expect(relogin).toMatchObject({ ok: false, reason: 'locked' });
    const denied = env.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'auth.unlock' AND result = 'denied'").get<{ c: number }>()!;
    expect(Number(denied.c)).toBe(3);
  });

  it('a correct password resets the counter', async () => {
    await addUser('nurse', 'assistant');
    const mgr = managerFor(3);
    await mgr.signIn('nurse', 'goodPass123');
    mgr.lock();
    await mgr.unlock('wrong-1');
    await mgr.unlock('wrong-2');
    expect(await mgr.unlock('goodPass123')).toEqual({ ok: true });
    mgr.lock();
    expect(await mgr.unlock('wrong-3')).toMatchObject({ ok: false, attemptsLeft: 2 });
  });
});

describe('V5-002 disabled or locked accounts lose their session', () => {
  it('a signed-in user disabled by an administrator is refused on the next call', async () => {
    const id = await addUser('reception', 'receptionist');
    const mgr = managerFor();
    await mgr.signIn('reception', 'goodPass123');
    expect(mgr.require().userId).toBe(id);
    env.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(id);
    await expectAppError(() => mgr.require(), 'AUTH', /disabled or locked/i);
    // The session is gone for good, not just for one call.
    expect(mgr.current()).toBeNull();
    await expectAppError(() => mgr.require(), 'AUTH', /sign in/i);
  });

  it('a locked-status account cannot be unlocked from the lock screen', async () => {
    const id = await addUser('reception', 'receptionist');
    const mgr = managerFor();
    await mgr.signIn('reception', 'goodPass123');
    mgr.lock();
    env.db.prepare("UPDATE users SET status = 'locked' WHERE id = ?").run(id);
    await expectAppError(mgr.unlock('goodPass123'), 'AUTH');
    expect(mgr.current()).toBeNull();
  });
});

describe('V5-013 manual backup requires backup.create', () => {
  function service() {
    return createBackupService({ paths: env.paths, holder: { get: () => env.db, set: () => {} }, appVersion: 'test', notify: () => {} });
  }

  it('refuses roles without backup.create and writes nothing', async () => {
    const svc = service();
    const assistant = ctxFor(1, 'assistant', BUILTIN_ROLES.assistant.permissions);
    const receptionist = ctxFor(1, 'receptionist', BUILTIN_ROLES.receptionist.permissions);
    const dest = path.join(env.dir, 'usb');
    await expectAppError(svc.runManualBackup(assistant, dest), 'PERMISSION', /backup\.create/);
    await expectAppError(svc.runManualBackup(receptionist, dest), 'PERMISSION', /backup\.create/);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('lets the owner back up and rejects relative destinations', async () => {
    const svc = service();
    const rec = await svc.runManualBackup(ownerCtx(env), path.join(env.dir, 'manual'));
    expect(rec.status).toBe('ok');
    expect(fs.existsSync(rec.path)).toBe(true);
    await expectAppError(svc.runManualBackup(ownerCtx(env), 'relative/folder'), 'VALIDATION');
    const fallback = await svc.runManualBackup(ownerCtx(env), null);
    expect(path.dirname(fallback.path)).toBe(env.paths.backupsDir);
  });
});

describe('V5-017 automatic retention never deletes manual or pre-restore backups', () => {
  it('prunes only tracked automatic backups in the destination', async () => {
    const svc = createBackupService({ paths: env.paths, holder: { get: () => env.db, set: () => {} }, appVersion: 'test', notify: () => {} });
    const dest = path.join(env.dir, 'shared-folder');
    saveSettings(ownerCtx(env), { backup: { autoFrequencyDays: 7, destination: dest, retention: 1 } as any });
    const manual = await svc.runBackup(ownerCtx(env), dest, 'manual');
    const preRestore = await svc.runBackup(ownerCtx(env), dest, 'pre_restore');
    const auto1 = await svc.runBackup(ownerCtx(env), dest, 'auto');
    const auto2 = await svc.runBackup(ownerCtx(env), dest, 'auto');
    expect(fs.existsSync(manual.path)).toBe(true);
    expect(fs.existsSync(preRestore.path)).toBe(true);
    expect(fs.existsSync(auto2.path)).toBe(true);
    expect(fs.existsSync(auto1.path)).toBe(false);
    const autoRows = env.db.prepare("SELECT COUNT(*) c FROM backups WHERE kind = 'auto' AND status = 'ok'").get<{ c: number }>()!;
    expect(Number(autoRows.c)).toBe(1);
  });
});

describe('V5-014 per-user permission overrides', () => {
  it('a demoted user keeps nothing from the previous role', async () => {
    const owner = ownerCtx(env);
    const created = await saveUser(owner, { username: 'manager', displayName: 'Manager', roleId: roleId('administrator'), password: 'abc12345' });
    expect(created.permissions).toContain('users.manage');
    // The UI sends null when "Override role permissions" is off.
    const demoted = await saveUser(owner, { id: created.id, username: 'manager', displayName: 'Manager', roleId: roleId('receptionist'), status: 'active', permissions: null });
    expect(new Set(demoted.permissions)).toEqual(new Set(BUILTIN_ROLES.receptionist.permissions));
    expect(demoted.hasPermissionOverrides).toBe(false);
  });

  it('re-submitting the old effective set on a role change is stored as an explicit override, visible as such', async () => {
    const owner = ownerCtx(env);
    const created = await saveUser(owner, { username: 'manager', displayName: 'Manager', roleId: roleId('administrator'), password: 'abc12345' });
    const kept = await saveUser(owner, {
      id: created.id, username: 'manager', displayName: 'Manager', roleId: roleId('receptionist'), status: 'active',
      permissions: created.permissions,
    });
    // An explicit, owner-made override is allowed — and it is flagged, never silent.
    expect(kept.hasPermissionOverrides).toBe(true);
  });

  it('unticking a role permission revokes it for that user only', async () => {
    const owner = ownerCtx(env);
    const reception = BUILTIN_ROLES.receptionist.permissions;
    const user = await saveUser(owner, { username: 'desk', displayName: 'Desk', roleId: roleId('receptionist'), password: 'abc12345' });
    const narrowed = await saveUser(owner, {
      id: user.id, username: 'desk', displayName: 'Desk', roleId: roleId('receptionist'), status: 'active',
      permissions: reception.filter((p) => p !== 'billing.payment.create'),
    });
    expect(narrowed.permissions).not.toContain('billing.payment.create');
    expect(loadPermissions(env.db, user.id, roleId('receptionist'))).not.toContain('billing.payment.create');
    const other = await saveUser(owner, { username: 'desk2', displayName: 'Desk 2', roleId: roleId('receptionist'), password: 'abc12345' });
    expect(other.permissions).toContain('billing.payment.create');
    // null restores exactly the role's permissions; undefined keeps overrides.
    const kept = await saveUser(owner, { id: user.id, username: 'desk', displayName: 'Desk renamed', roleId: roleId('receptionist'), status: 'active' });
    expect(kept.permissions).not.toContain('billing.payment.create');
    const cleared = await saveUser(owner, { id: user.id, username: 'desk', displayName: 'Desk renamed', roleId: roleId('receptionist'), status: 'active', permissions: null });
    expect(cleared.permissions).toContain('billing.payment.create');
    expect(cleared.hasPermissionOverrides).toBe(false);
  });

  it('listUsers reports which users carry overrides', async () => {
    const owner = ownerCtx(env);
    const user = await saveUser(owner, { username: 'desk', displayName: 'Desk', roleId: roleId('receptionist'), password: 'abc12345', permissions: [...BUILTIN_ROLES.receptionist.permissions, 'inventory.view'] });
    const rows = await listUsers(owner);
    expect(rows.find((u) => u.id === user.id)?.hasPermissionOverrides).toBe(true);
    expect(rows.find((u) => u.id === 1)?.hasPermissionOverrides).toBe(false);
  });
});

describe('V5-015 deleting accounts', () => {
  it('an Administrator cannot delete the Owner, and data.delete alone is not enough', async () => {
    const adminId = await addUser('admin', 'administrator');
    const admin = ctxFor(adminId, 'administrator', BUILTIN_ROLES.administrator.permissions);
    await expectAppError(() => deleteUser(admin, 1), 'PERMISSION', /only the owner/i);
    const deleterOnly = ctxFor(adminId, 'custom', ['data.delete']);
    const victim = await addUser('victim', 'receptionist');
    await expectAppError(() => deleteUser(deleterOnly, victim), 'PERMISSION', /users\.manage/);
    expect(deleteUser(admin, victim)).toEqual({ ok: true });
  });

  it('the last active Owner can never be deleted; missing users give NOT_FOUND', async () => {
    const coOwnerId = await addUser('coowner', 'owner');
    const coOwner = ctxFor(coOwnerId, 'owner', BUILTIN_ROLES.owner.permissions);
    // Two owners: co-owner may delete owner #1 …
    expect(deleteUser(coOwner, 1)).toEqual({ ok: true });
    // … but then is the last owner, and cannot be deleted by anyone.
    const third = await addUser('third', 'owner');
    env.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(third);
    const thirdCtx = ctxFor(third, 'owner', BUILTIN_ROLES.owner.permissions);
    await expectAppError(() => deleteUser(thirdCtx, coOwnerId), 'CONFLICT', /at least one active owner/i);
    await expectAppError(() => deleteUser(coOwner, 99999), 'NOT_FOUND');
    await expectAppError(() => deleteUser(coOwner, coOwnerId), 'CONFLICT', /your own/i);
  });
});

describe('V5-016 privilege ceiling and self-protection', () => {
  async function hrCtx(): Promise<Ctx> {
    const owner = ownerCtx(env);
    const hr = await saveRole(owner, { name: 'HR', permissions: ['users.manage', 'staff.view', 'dashboard.view'] });
    const now = new Date().toISOString();
    const id = Number(env.db.prepare(
      "INSERT INTO users (username, display_name, password_hash, role_id, status, created_at, updated_at) VALUES ('hrlead', 'HR lead', 'x', ?, 'active', ?, ?)",
    ).run(hr.id, now, now).lastInsertRowid);
    return ctxFor(id, hr.key, ['users.manage', 'staff.view', 'dashboard.view']);
  }

  it('a users.manage-only role cannot hand out Administrator or extra permissions', async () => {
    const hr = await hrCtx();
    await expectAppError(saveUser(hr, { username: 'puppet', displayName: 'Puppet', roleId: roleId('administrator'), password: 'abc12345' }), 'PERMISSION', /do not have yourself/i);
    // Self-escalation through the own account is refused too.
    await expectAppError(saveUser(hr, { id: hr.session.userId, username: 'hrlead', displayName: 'HR lead', roleId: roleId('administrator'), status: 'active' }), 'PERMISSION');
    // A role within the actor's own permissions is fine.
    const custom = await saveRole(ownerCtx(env), { name: 'Viewer', permissions: ['dashboard.view'] });
    const ok = await saveUser(hr, { username: 'viewer', displayName: 'Viewer', roleId: custom.id, password: 'abc12345' });
    expect(ok.permissions).toEqual(['dashboard.view']);
  });

  it('a non-owner cannot manage an account with more access than their own', async () => {
    const hr = await hrCtx();
    const adminId = await addUser('admin', 'administrator');
    await expectAppError(saveUser(hr, { id: adminId, username: 'admin', displayName: 'Admin', roleId: roleId('administrator'), status: 'disabled' }), 'PERMISSION');
    await expectAppError(resetPassword(hr, adminId, 'newPass123'), 'PERMISSION');
  });

  it('roles.manage cannot create a role beyond the actor’s permissions', async () => {
    const limited = ctxFor(1, 'custom', ['roles.manage', 'dashboard.view']);
    await expectAppError(Promise.resolve().then(() => saveRole(limited, { name: 'Escalate', permissions: ['backup.restore'] })), 'PERMISSION', /backup\.restore/);
  });

  it('nobody changes their own role or status, and the last active Owner stays', async () => {
    const owner = ownerCtx(env);
    await expectAppError(saveUser(owner, { id: 1, username: 'owner', displayName: 'Owner', roleId: roleId('receptionist'), status: 'active' }), 'PERMISSION', /your own/i);
    await expectAppError(saveUser(owner, { id: 1, username: 'owner', displayName: 'Owner', roleId: roleId('owner'), status: 'disabled' }), 'PERMISSION', /your own/i);
    const coOwnerId = await addUser('coowner', 'owner');
    const coOwner = ctxFor(coOwnerId, 'owner', BUILTIN_ROLES.owner.permissions);
    // With two owners, one may demote the other …
    const demoted = await saveUser(coOwner, { id: 1, username: 'owner', displayName: 'Owner', roleId: roleId('administrator'), status: 'active', permissions: null });
    expect(demoted.roleId).toBe(roleId('administrator'));
    // … but the remaining Owner cannot be demoted by the other remaining owner-less path.
    const third = await addUser('third', 'owner');
    env.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(third);
    const thirdCtx = ctxFor(third, 'owner', BUILTIN_ROLES.owner.permissions);
    await expectAppError(saveUser(thirdCtx, { id: coOwnerId, username: 'coowner', displayName: 'Co', roleId: roleId('administrator'), status: 'active' }), 'CONFLICT', /at least one active owner/i);
  });
});

describe('V5-006 clinic logo path is owned by the main process', () => {
  it('ignores renderer-supplied paths and never serves non-logo files', () => {
    const owner = ownerCtx(env);
    fs.writeFileSync(path.join(env.paths.dataDir, 'secret.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    saveSettings(owner, { clinic: { clinicName: 'Clinic', logoPath: 'dentiva.db' } as any });
    expect(getSettings(owner).clinic.logoPath ?? null).toBeNull();
    // A hand-edited row pointing at the database is not served either.
    env.db.prepare("UPDATE settings SET value_json = json_set(value_json, '$.logoPath', 'dentiva.db') WHERE key = 'clinic'").run();
    expect(getSettings(owner).clinic.logoDataUrl).toBeNull();
    env.db.prepare("UPDATE settings SET value_json = json_set(value_json, '$.logoPath', 'secret.png') WHERE key = 'clinic'").run();
    expect(getSettings(owner).clinic.logoDataUrl).toBeNull();
  });

  it('resolveManagedLogoPath accepts only image files directly inside branding/', () => {
    const data = env.paths.dataDir;
    expect(resolveManagedLogoPath(data, path.join('branding', 'logo-1.png'))).toBe(path.join(data, 'branding', 'logo-1.png'));
    expect(resolveManagedLogoPath(data, 'dentiva.db')).toBeNull();
    expect(resolveManagedLogoPath(data, path.join('branding', 'notes.txt'))).toBeNull();
    expect(resolveManagedLogoPath(data, path.join('branding', 'sub', 'logo.png'))).toBeNull();
    expect(resolveManagedLogoPath(data, path.join('..', 'branding', 'logo.png'))).toBeNull();
    expect(resolveManagedLogoPath(data, path.resolve('/', 'tmp', 'branding', 'logo.png'))).toBeNull();
    expect(resolveManagedLogoPath(data, null)).toBeNull();
  });

  it('clearing the logo still works', () => {
    const owner = ownerCtx(env);
    env.db.prepare("UPDATE settings SET value_json = json_set(value_json, '$.logoPath', 'branding/logo-1.png') WHERE key = 'clinic'").run();
    saveSettings(owner, { clinic: { clinicName: 'Clinic', logoPath: null } as any });
    expect(getSettings(owner).clinic.logoPath ?? null).toBeNull();
  });
});

describe('V5-007 verified pre-migration safety copy', () => {
  const FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'v4.2.2', 'dentiva-v4.2.2.db');

  it('copies an existing database before migrating it and keeps the newest copies', () => {
    const target = path.join(env.dir, 'upgrade', 'data', 'dentiva.db');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    for (let i = 0; i < PRE_MIGRATION_KEEP + 1; i += 1) {
      fs.copyFileSync(FIXTURE, target);
      for (const sfx of ['-wal', '-shm']) fs.rmSync(target + sfx, { force: true });
      const opened = openDatabase(target);
      try {
        expect(opened.preMigrationCopy).not.toBeNull();
        const copy = new Database(opened.preMigrationCopy!, { readonly: true });
        try {
          expect(copy.pragma('quick_check', { simple: true })).toBe('ok');
          expect(Number(copy.pragma('user_version', { simple: true }))).toBe(7);
          expect(Number((copy.prepare('SELECT COUNT(*) c FROM patients').get() as { c: number }).c)).toBeGreaterThan(0);
        } finally {
          copy.close();
        }
        expect(opened.schemaVersion).toBeGreaterThan(7);
      } finally {
        opened.db.close();
      }
    }
    const copies = fs.readdirSync(path.join(path.dirname(target), PRE_MIGRATION_DIR)).filter((f) => f.endsWith('.db'));
    expect(copies).toHaveLength(PRE_MIGRATION_KEEP);
  });

  it('writes no copy for a new database or an up-to-date one', () => {
    const target = path.join(env.dir, 'fresh', 'dentiva.db');
    const first = openDatabase(target);
    expect(first.preMigrationCopy).toBeNull();
    first.db.close();
    const again = openDatabase(target);
    expect(again.preMigrationCopy).toBeNull();
    again.db.close();
    expect(fs.existsSync(path.join(path.dirname(target), PRE_MIGRATION_DIR))).toBe(false);
  });
});

describe('V5-008 links to visits and treatments are validated', () => {
  function fixture() {
    const owner = ownerCtx(env);
    const a = createPatient(owner, { name: 'Patient A', gender: 'female', ageYears: 40, phone: '01711111111' });
    const b = createPatient(owner, { name: 'Patient B', gender: 'male', ageYears: 35, phone: '01722222222' });
    const visitOfB = createVisit(owner, { patientId: b.id, datetime: '2026-09-01T10:00' } as any);
    const now = new Date().toISOString();
    const dentistId = Number(env.db.prepare("INSERT INTO dentists (name, active, created_at, updated_at) VALUES ('Dr. Test', 1, ?, ?)").run(now, now).lastInsertRowid);
    return { owner, a, b, visitOfB, dentistId };
  }

  it('an invoice cannot be attached to another patient’s visit or a missing treatment', () => {
    const { owner, a, b, visitOfB } = fixture();
    const line = { description: 'Consultation', qty: 1, unitPricePaisa: 50000 };
    expect(() => createInvoice(owner, { patientId: a.id, visitId: visitOfB.id, items: [line] } as any)).toThrow(/different patient/i);
    expect(() => createInvoice(owner, { patientId: a.id, visitId: 99999, items: [line] } as any)).toThrow(/visit was not found/i);
    expect(() => createInvoice(owner, { patientId: a.id, items: [{ ...line, treatmentId: 99999 }] } as any)).toThrow(/no longer exists/i);
    const ok = createInvoice(owner, { patientId: b.id, visitId: visitOfB.id, items: [line] } as any);
    expect(ok.visitId).toBe(visitOfB.id);
  });

  it('prescriptions and chart entries are held to the same rule', () => {
    const { owner, a, visitOfB, dentistId } = fixture();
    expect(() => createPrescription(owner, { patientId: a.id, dentistId, visitId: visitOfB.id, items: [{ medicineName: 'Amoxicillin' }] })).toThrow(/different patient/i);
    expect(() => setChart(owner, a.id, { visitId: visitOfB.id, changes: [{ tooth: '11', condition: 'caries', action: 'set' }] } as any)).toThrow(/different patient/i);
  });
});

describe('V5-009 medicine templates', () => {
  it('validates template items and reports a missing template as NOT_FOUND', async () => {
    const owner = ownerCtx(env);
    expect(() => saveTemplate(owner, 'Bad', [{ medicineName: '' }])).toThrow(/medicine #1 name is required/i);
    expect(() => saveTemplate(owner, 'Bad', [{ medicineName: 'X', timing: 'sometimes' } as any])).toThrow(/food timing/i);
    const saved = saveTemplate(owner, 'Post-extraction', [{ medicineName: 'Paracetamol 500 mg', timing: 'after', unknownField: 'dropped' } as any]);
    const stored = JSON.parse(env.db.prepare('SELECT items_json FROM medicine_templates WHERE id = ?').get<{ items_json: string }>(saved.id)!.items_json);
    expect(stored[0]).toMatchObject({ medicineName: 'Paracetamol 500 mg', timing: 'after' });
    expect(stored[0].unknownField).toBeUndefined();
    await expectAppError(() => deleteTemplate(owner, 424242), 'NOT_FOUND');
  });
});
