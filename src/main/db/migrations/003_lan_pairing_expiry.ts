import type { DB } from '../database';

export const migration003 = {
  version: 3,
  name: 'lan_pairing_expiry',
  ddl: `
    ALTER TABLE lan_config ADD COLUMN pairing_secret_expires_at TEXT;
  `,
  seed(_db: DB) {
    // No seed data required; existing pairing secrets remain invalid until regenerated.
  },
};
