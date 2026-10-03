import type { DB } from '../database';

export const migration002 = {
  version: 2,
  name: 'lan_foundation',
  ddl: `
    CREATE TABLE IF NOT EXISTS lan_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      port INTEGER NOT NULL DEFAULT 47821,
      clinic_id TEXT,
      server_name TEXT,
      pairing_secret_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lan_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL UNIQUE,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL DEFAULT 'workstation',
      status TEXT NOT NULL DEFAULT 'pending',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      last_ip TEXT,
      last_seen_at TEXT,
      approved_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lan_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      device_id INTEGER NOT NULL REFERENCES lan_devices(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_lan_devices_status ON lan_devices(status);
    CREATE INDEX IF NOT EXISTS idx_lan_sessions_device ON lan_sessions(device_id);
    CREATE INDEX IF NOT EXISTS idx_lan_sessions_expires ON lan_sessions(expires_at);
  `,
  seed(db: DB) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO lan_config
        (id, enabled, port, server_name, created_at, updated_at)
      VALUES (1, 0, 47821, 'Dentiva Pro Server', ?, ?)
    `).run(now, now);
  },
};