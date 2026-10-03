import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, type TestEnv } from '../helpers';
import { LanServer } from '../../src/main/lan-server';
import { hashPassword } from '../../src/main/core/passwords';

let env: TestEnv;
let lan: LanServer;

beforeEach(() => {
  env = createTestEnv('lan');
  lan = new LanServer(env.db);
  env.db.prepare('UPDATE lan_config SET enabled = 1 WHERE id = 1').run();
});

afterEach(() => {
  cleanupEnv(env);
});

describe('LAN pairing and sessions', () => {
  it('pairs a device and consumes the pairing code exactly once', () => {
    const { code } = lan.createPairingCode();
    expect(code).toMatch(/^\d{6}$/);

    const first = lan.pairDevice('desktop-01', 'Front Desk PC', code, '192.168.1.20');
    expect(first.deviceId).toBe('desktop-01');
    expect(first.deviceName).toBe('Front Desk PC');
    expect(first.sessionToken).toBeTruthy();
    expect(lan.authenticate(first.sessionToken)?.deviceId).toBe('desktop-01');

    expect(() => lan.pairDevice('desktop-02', 'Second PC', code, '192.168.1.21')).toThrow(/invalid or expired/i);
  });

  it('rejects an expired pairing code', () => {
    const { code } = lan.createPairingCode();
    env.db.prepare('UPDATE lan_config SET pairing_secret_expires_at = ? WHERE id = 1')
      .run(new Date(Date.now() - 1000).toISOString());

    expect(() => lan.pairDevice('expired-01', 'Expired Device', code, '192.168.1.22'))
      .toThrow(/invalid or expired/i);
  });

  it('rejects pairing while LAN mode is disabled', () => {
    env.db.prepare('UPDATE lan_config SET enabled = 0 WHERE id = 1').run();
    const { code } = lan.createPairingCode();

    expect(() => lan.pairDevice('disabled-01', 'Disabled Device', code, '192.168.1.23'))
      .toThrow(/disabled/i);
  });

  it('binds a paired device session to a real Dentiva user', async () => {
    const role = env.db.prepare("SELECT id FROM roles WHERE key = 'owner'").get<{ id: number }>();
    expect(role?.id).toBeTruthy();
    const now = new Date().toISOString();
    const passwordHash = await hashPassword('StrongPass123!');
    const result = env.db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role_id, status, failed_attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', 0, ?, ?)
    `).run('lanadmin', 'LAN Admin', passwordHash, role!.id, now, now);

    const { code } = lan.createPairingCode();
    const paired = lan.pairDevice('auth-01', 'Auth Device', code, '192.168.1.30');

    const authenticated = await lan.loginUser(paired.sessionToken, 'lanadmin', 'StrongPass123!', {
      maxFailedLogins: 5,
      minPasswordLength: 8,
    });
    expect(authenticated?.deviceId).toBe('auth-01');
    expect(authenticated?.user.username).toBe('lanadmin');

    const session = lan.authenticate(paired.sessionToken);
    expect(session?.userId).toBe(Number(result.lastInsertRowid));
  });

  it('rejects LAN login with an invalid device session', async () => {
    await expect(lan.loginUser('invalid-token', 'nobody', 'wrong-password', {
      maxFailedLogins: 5,
      minPasswordLength: 8,
    })).resolves.toBeNull();
  });

  it('revokes a device and invalidates its active session', () => {
    const { code } = lan.createPairingCode();
    const paired = lan.pairDevice('revocable-01', 'Revocable Device', code, '192.168.1.24');
    expect(lan.authenticate(paired.sessionToken)).not.toBeNull();

    lan.revokeDevice('revocable-01');

    expect(lan.authenticate(paired.sessionToken)).toBeNull();
    const row = env.db.prepare('SELECT status, revoked_at FROM lan_devices WHERE device_id = ?')
      .get('revocable-01') as { status: string; revoked_at: string | null };
    expect(row.status).toBe('revoked');
    expect(row.revoked_at).toBeTruthy();
  });

  it('limits repeated pairing attempts from one IP', () => {
    const { code } = lan.createPairingCode();

    for (let i = 0; i < 10; i += 1) {
      expect(() => lan.pairDevice(`rate-${i}`, 'Rate Test', '000000', '192.168.1.25'))
        .toThrow(/invalid or expired/i);
    }

    expect(() => lan.pairDevice('rate-final', 'Rate Test', code, '192.168.1.25'))
      .toThrow(/too many pairing attempts/i);
  });
});
