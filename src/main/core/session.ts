import type { DB } from '../db/database';
import type { SessionUser } from '../../shared/types';
import { authError } from '../errors';
import { audit } from './context';
import { loadSessionUser, login as svcLogin, type SecurityPolicy } from '../services/auth';
import { verifyPassword } from './passwords';

export interface SessionManagerDeps {
  db: () => DB;
  securityPolicy: () => SecurityPolicy;
  onLock: () => void;
}

/**
 * Main-process authority for authentication state, lock state and idle auto-lock.
 * The renderer never decides whether it is authenticated.
 */
export type UnlockResult =
  | { ok: true }
  | { ok: false; error: string; attemptsLeft: number };

/**
 * Main-process authority for authentication state, lock state and idle auto-lock.
 * The renderer never decides whether it is authenticated.
 */
export class SessionManager {
  private user: SessionUser | null = null;
  private locked = false;
  private lastActivity = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private autoLockProvider: () => number | null = () => 10;
  /** Consecutive failed unlock attempts for the current session (V5-001). */
  private unlockFailures = 0;

  constructor(private readonly deps: SessionManagerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkIdle(), 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setAutoLockProvider(fn: () => number | null): void {
    this.autoLockProvider = fn;
  }

  private checkIdle(): void {
    if (!this.user || this.locked) return;
    const minutes = this.autoLockProvider();
    if (minutes === null || minutes <= 0) return;
    if (Date.now() - this.lastActivity > minutes * 60_000) {
      this.lock();
    }
  }

  async signIn(username: string, password: string): Promise<ReturnType<typeof svcLogin>> {
    const result = await svcLogin(this.deps.db(), username, password, this.deps.securityPolicy());
    if (result.ok) {
      this.user = result.user;
      this.locked = false;
      this.unlockFailures = 0;
      this.touch();
    }
    return result;
  }

  signOut(): void {
    if (this.user) this.deps.onLock(); // close other windows before forgetting the session
    this.user = null;
    this.locked = false;
    this.unlockFailures = 0;
  }

  lock(): void {
    if (!this.user) return;
    if (this.locked) return;
    this.locked = true;
    this.deps.onLock();
  }

  /**
   * Re-authenticate the locked session.
   *
   * The lock screen is a password prompt on an unattended workstation, so it
   * carries the same brute-force limit as the sign-in screen: after
   * `maxFailedLogins` consecutive wrong passwords the session is ended and the
   * account is temporarily locked exactly like a failed sign-in (5 minutes).
   * The caller receives an AUTH error, which returns every window to sign-in.
   * A disabled, locked or deleted account can never be unlocked.
   */
  async unlock(password: string): Promise<UnlockResult> {
    if (!this.user) throw authError('Please sign in to continue.');
    const db = this.deps.db();
    const session = this.user;
    const row = db
      .prepare('SELECT password_hash, status, locked_until FROM users WHERE id = ? AND deleted_at IS NULL')
      .get<{ password_hash: string; status: string; locked_until: string | null }>(session.userId);
    if (!row || row.status !== 'active') {
      this.signOut();
      throw authError('This account has been disabled or locked by an administrator. Sign in with another account.');
    }
    const ok = await verifyPassword(row.password_hash, String(password ?? ''));
    if (ok) {
      this.locked = false;
      this.unlockFailures = 0;
      this.touch();
      return { ok: true };
    }
    this.unlockFailures += 1;
    const limit = Math.max(1, Number(this.deps.securityPolicy().maxFailedLogins) || 5);
    const attemptsLeft = Math.max(0, limit - this.unlockFailures);
    if (attemptsLeft === 0) {
      const now = Date.now();
      const lockedUntil = new Date(now + 5 * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET failed_attempts = failed_attempts + 1, locked_until = ?, updated_at = ? WHERE id = ?')
        .run(lockedUntil, new Date(now).toISOString(), session.userId);
      audit({ db, session }, {
        action: 'auth.unlock', entityType: 'user', entityId: session.userId,
        summary: `Signed out after ${this.unlockFailures} failed unlock attempts for "${session.username}" — account temporarily locked`,
        result: 'denied',
      });
      this.signOut();
      throw authError('Too many incorrect passwords. You have been signed out and the account is locked for 5 minutes.');
    }
    audit({ db, session }, {
      action: 'auth.unlock', entityType: 'user', entityId: session.userId,
      summary: `Failed unlock attempt for "${session.username}" (attempt ${this.unlockFailures} of ${limit})`, result: 'denied',
    });
    return { ok: false, error: 'Incorrect password.', attemptsLeft };
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  isLocked(): boolean {
    return this.locked;
  }

  /** Throws when there is no live, unlocked session — used by every protected IPC handler. */
  require(): SessionUser {
    if (!this.user) throw authError('Please sign in to continue.');
    if (this.locked) throw authError('Application is locked.');
    let fresh: SessionUser;
    try {
      fresh = loadSessionUser(this.deps.db(), this.user.userId);
    } catch (err) {
      // Disabled, locked or deleted since sign-in: end the session for good.
      this.signOut();
      throw err;
    }
    this.user = fresh;
    return fresh;
  }

  current(): SessionUser | null {
    if (!this.user || this.locked) return null;
    return this.user;
  }
}
