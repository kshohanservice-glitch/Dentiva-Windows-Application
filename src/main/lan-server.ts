import http from 'node:http';
import crypto from 'node:crypto';
import type { DB } from './db/database';

const PAIRING_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const PAIR_ATTEMPT_WINDOW_MS = 60_000;
const MAX_PAIR_ATTEMPTS_PER_IP = 10;

export type LanServerStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  host: string;
  serverName: string;
  connectedDevices: number;
};

export type LanPairingResult = { deviceId: string; deviceName: string; sessionToken: string; expiresAt: string };
export type LanDevice = { deviceId: string; deviceName: string; status: string; lastIp: string | null; lastSeenAt: string | null; approvedAt: string | null; revokedAt: string | null };

type ConfigRow = {
  enabled: number;
  port: number;
  server_name: string | null;
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export class LanServer {
  private server: http.Server | null = null;
  private readonly host = '0.0.0.0';
  private readonly pairAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly db: DB) {}

  getStatus(): LanServerStatus {
    const row = this.db.prepare(
      'SELECT enabled, port, server_name FROM lan_config WHERE id = 1'
    ).get() as ConfigRow | undefined;
    const connected = this.db.prepare(
      "SELECT COUNT(*) AS count FROM lan_sessions WHERE revoked_at IS NULL AND expires_at > ?"
    ).get(new Date().toISOString()) as { count: number };
    return {
      enabled: row?.enabled === 1,
      running: this.server !== null,
      port: row?.port ?? 47821,
      host: this.host,
      serverName: row?.server_name ?? 'Dentiva Pro Server',
      connectedDevices: Number(connected.count ?? 0),
    };
  }

  listDevices(): LanDevice[] {
    const rows = this.db.prepare(`SELECT device_id, device_name, status, last_ip, last_seen_at, approved_at, revoked_at FROM lan_devices ORDER BY COALESCE(last_seen_at, created_at) DESC`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ deviceId: String(row.device_id), deviceName: String(row.device_name), status: String(row.status), lastIp: row.last_ip == null ? null : String(row.last_ip), lastSeenAt: row.last_seen_at == null ? null : String(row.last_seen_at), approvedAt: row.approved_at == null ? null : String(row.approved_at), revokedAt: row.revoked_at == null ? null : String(row.revoked_at) }));
  }

  async start(): Promise<void> {
    if (this.server) return;
    const row = this.db.prepare(
      'SELECT enabled, port FROM lan_config WHERE id = 1'
    ).get() as { enabled: number; port: number } | undefined;
    if (row?.enabled !== 1) return;

    const port = Number(row.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Invalid Dentiva LAN server port.');
    }

    const server = http.createServer((req, res) => {
      req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy());
      res.setTimeout(REQUEST_TIMEOUT_MS, () => res.destroy());
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (req.method === 'GET' && url.pathname === '/health') {
          json(res, 200, { ok: true, product: 'Dentiva Pro', protocol: 1 });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/lan/status') {
          json(res, 200, this.getStatus());
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/lan/pair') {
          let body = '';
          let bodyBytes = 0;
          let tooLarge = false;
          let responded = false;
          req.setEncoding('utf8');
          req.on('data', (chunk) => {
            bodyBytes += Buffer.byteLength(chunk, 'utf8');
            if (bodyBytes > MAX_BODY_BYTES) {
              tooLarge = true;
              if (!responded) { responded = true; json(res, 413, { ok: false, error: 'REQUEST_TOO_LARGE' }); }
              req.destroy();
              return;
            }
            body += chunk;
          });
          req.on('end', () => {
            try {
              if (tooLarge || responded) return;
              const input = JSON.parse(body) as { deviceId?: string; deviceName?: string; pairingCode?: string };
              const result = this.pairDevice(String(input.deviceId ?? ''), String(input.deviceName ?? ''), String(input.pairingCode ?? ''), req.socket.remoteAddress ?? null);
              if (!responded) { responded = true; json(res, 200, { ok: true, ...result }); }
            } catch (err) { if (!responded) { responded = true; json(res, 401, { ok: false, error: err instanceof Error ? err.message : 'PAIRING_FAILED' }); } }
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/lan/session') {
          const auth = String(req.headers.authorization ?? '');
          const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
          const session = this.authenticate(token);
          if (!session) { json(res, 401, { ok: false, error: 'UNAUTHORIZED' }); return; }
          json(res, 200, { ok: true, session });
          return;
        }
        json(res, 404, { ok: false, error: 'NOT_FOUND' });
      } catch {
        json(res, 400, { ok: false, error: 'BAD_REQUEST' });
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, this.host);
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  issueSessionToken(rawToken: string): string {
    return tokenHash(rawToken);
  }

  createPairingCode(): { code: string; expiresAt: string } {
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    const hash = tokenHash(code);
    this.db.prepare(`UPDATE lan_config SET pairing_secret_hash = ?, pairing_secret_expires_at = ?, updated_at = ? WHERE id = 1`).run(hash, expiresAt, new Date().toISOString());
    return { code, expiresAt };
  }

  pairDevice(deviceId: string, deviceName: string, pairingCode: string, ip: string | null): LanPairingResult {
    const config = this.db.prepare('SELECT enabled FROM lan_config WHERE id = 1').get() as { enabled: number } | undefined;
    if (config?.enabled !== 1) throw new Error('LAN server is disabled.');
    const cleanId = String(deviceId || '').trim().slice(0, 128);
    const cleanName = String(deviceName || '').trim().slice(0, 120);
    const code = String(pairingCode || '').trim();
    if (!/^[A-Za-z0-9._-]{3,128}$/.test(cleanId) || !cleanName || !/^\d{6}$/.test(code)) {
      throw new Error('Invalid LAN pairing request.');
    }
    const attemptKey = ip ?? 'unknown';
    const nowMs = Date.now();
    const attempt = this.pairAttempts.get(attemptKey);
    if (attempt && attempt.resetAt > nowMs && attempt.count >= MAX_PAIR_ATTEMPTS_PER_IP) throw new Error('Too many pairing attempts. Try again later.');
    if (!attempt || attempt.resetAt <= nowMs) this.pairAttempts.set(attemptKey, { count: 1, resetAt: nowMs + PAIR_ATTEMPT_WINDOW_MS });
    else attempt.count += 1;
    const row = this.db.prepare('SELECT pairing_secret_hash, pairing_secret_expires_at FROM lan_config WHERE id = 1').get() as { pairing_secret_hash: string | null; pairing_secret_expires_at: string | null } | undefined;
    const expected = tokenHash(code);
    const validHash = !!row?.pairing_secret_hash && row.pairing_secret_hash.length === expected.length && crypto.timingSafeEqual(Buffer.from(row.pairing_secret_hash), Buffer.from(expected));
    if (!validHash || !row?.pairing_secret_expires_at || row.pairing_secret_expires_at <= new Date().toISOString()) {
      throw new Error('Invalid or expired pairing code.');
    }
    const now = new Date().toISOString();
    // Pairing is a single atomic DB transaction so concurrent requests cannot
    // both consume the same one-time pairing code.
    const pair = this.db.transaction(() => {
      const current = this.db.prepare('SELECT pairing_secret_hash, pairing_secret_expires_at FROM lan_config WHERE id = 1').get() as { pairing_secret_hash: string | null; pairing_secret_expires_at: string | null } | undefined;
      const currentExpected = tokenHash(code);
      const currentValidHash = !!current?.pairing_secret_hash
        && current.pairing_secret_hash.length === currentExpected.length
        && crypto.timingSafeEqual(Buffer.from(current.pairing_secret_hash), Buffer.from(currentExpected));
      if (!currentValidHash || !current?.pairing_secret_expires_at || current.pairing_secret_expires_at <= now) {
        throw new Error('Invalid or expired pairing code.');
      }
      this.db.prepare(`UPDATE lan_config SET pairing_secret_hash = NULL, pairing_secret_expires_at = NULL, updated_at = ? WHERE id = 1`).run(now);

      const device = this.db.prepare('SELECT id FROM lan_devices WHERE device_id = ?').get(cleanId) as { id: number } | undefined;
    let devicePk: number;
    if (device) {
      devicePk = device.id;
      this.db.prepare(`UPDATE lan_devices SET device_name = ?, status = 'approved', last_ip = ?, last_seen_at = ?, approved_at = ?, revoked_at = NULL, updated_at = ? WHERE id = ?`).run(cleanName, ip, now, now, now, devicePk);
    } else {
      const result = this.db.prepare(`INSERT INTO lan_devices (device_id, device_name, status, last_ip, last_seen_at, approved_at, created_at, updated_at) VALUES (?, ?, 'approved', ?, ?, ?, ?, ?)`).run(cleanId, cleanName, ip, now, now, now, now);
      devicePk = Number(result.lastInsertRowid);
    }
      const rawToken = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      this.db.prepare(`INSERT INTO lan_sessions (token_hash, device_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`).run(tokenHash(rawToken), devicePk, now, expiresAt, now);
      return { deviceId: cleanId, deviceName: cleanName, sessionToken: rawToken, expiresAt };
    });
    return pair();
  }

  revokeDevice(deviceId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE lan_devices SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE device_id = ?`).run(now, now, deviceId);
    this.db.prepare(`UPDATE lan_sessions SET revoked_at = ? WHERE device_id IN (SELECT id FROM lan_devices WHERE device_id = ?) AND revoked_at IS NULL`).run(now, deviceId);
  }

  authenticate(rawToken: string): { deviceId: string; userId: number | null } | null {
    const hash = tokenHash(rawToken);
    const row = this.db.prepare(`SELECT d.device_id, s.user_id, d.status, s.expires_at, s.revoked_at FROM lan_sessions s JOIN lan_devices d ON d.id = s.device_id WHERE s.token_hash = ?`).get(hash) as any;
    if (!row || row.status !== 'approved' || row.revoked_at || row.expires_at <= new Date().toISOString()) return null;
    this.db.prepare('UPDATE lan_sessions SET last_seen_at = ? WHERE token_hash = ?').run(new Date().toISOString(), hash);
    return { deviceId: row.device_id, userId: row.user_id ?? null };
  }
}