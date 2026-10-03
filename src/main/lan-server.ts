import http from 'node:http';
import crypto from 'node:crypto';
import type { DB } from './db/database';

export type LanServerStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  host: string;
  serverName: string;
  connectedDevices: number;
};

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
}