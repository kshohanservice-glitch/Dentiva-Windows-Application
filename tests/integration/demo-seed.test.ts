import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, type TestEnv } from '../helpers';
import { seedDemoDatabase } from '../../src/main/demo';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('demo-seed', { seedOwner: false });
});

afterEach(() => {
  cleanupEnv(env);
});

describe('demo showcase seed', () => {
  it('initializes a complete ten-patient read-only showcase database', async () => {
    await seedDemoDatabase(env.db);

    expect(env.db.prepare('SELECT COUNT(*) c FROM patients').get<{ c: number }>()!.c).toBe(10);
    expect(env.db.prepare('SELECT COUNT(*) c FROM visits').get<{ c: number }>()!.c).toBeGreaterThanOrEqual(8);
    expect(env.db.prepare('SELECT COUNT(*) c FROM prescriptions').get<{ c: number }>()!.c).toBeGreaterThanOrEqual(5);
    expect(env.db.prepare('SELECT COUNT(*) c FROM invoices').get<{ c: number }>()!.c).toBeGreaterThanOrEqual(8);
    expect(env.db.prepare('SELECT COUNT(*) c FROM appointments').get<{ c: number }>()!.c).toBeGreaterThanOrEqual(8);
    expect(env.db.prepare('SELECT COUNT(*) c FROM inventory_items').get<{ c: number }>()!.c).toBeGreaterThanOrEqual(2);
    expect(env.db.prepare("SELECT value_json FROM settings WHERE key='clinic'").get()).toBeTruthy();
    expect(env.db.prepare("SELECT value_json FROM settings WHERE key='demo.seedVersion'").get()).toBeTruthy();
    expect(env.db.prepare("SELECT username FROM users WHERE username='demo'").get()).toBeTruthy();
  });
});
