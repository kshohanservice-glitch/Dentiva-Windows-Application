/**
 * Scale check at 20,000 synthetic patients (plus visits and appointments).
 * Rows are bulk-inserted in one transaction for speed; every read goes through the
 * real services. Thresholds are generous so the test catches regressions (missing
 * indexes, O(n) scans per keystroke) without being flaky on slow CI runners.
 * Synthetic data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { listPatients } from '../../src/main/services/patients';
import { globalSearch } from '../../src/main/services/search';
import { getDashboard } from '../../src/main/services/dashboard';
import { listAgenda } from '../../src/main/services/appointments';

const PATIENTS = 20_000;
let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('scale-20k');
});

afterEach(() => {
  cleanupEnv(env);
});

function seed(): { ms: number } {
  const now = new Date().toISOString();
  const t0 = Date.now();
  env.db.transaction(() => {
    const dentistId = Number(env.db.prepare(
      "INSERT INTO dentists (name, active, created_at, updated_at) VALUES ('Dr Scale', 1, ?, ?)").run(now, now).lastInsertRowid);
    const ins = env.db.prepare(
      `INSERT INTO patients (code, name, age_years, gender, phone, registration_date, created_at, updated_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`);
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    for (let i = 1; i <= PATIENTS; i++) {
      ins.run(`P-${String(i).padStart(6, '0')}`, `Synthetic Patient ${String(i).padStart(5, '0')}`,
        18 + (i % 60), i % 2 ? 'male' : 'female', `017${String(10000000 + i).slice(0, 8)}`,
        '2026-08-01', now, now);
    }
    const userId = (env.db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as { id: number }).id;
    const appt = env.db.prepare(
      `INSERT INTO appointments (patient_id, dentist_id, date, time, duration_min, type, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 30, 'Check-up', 'scheduled', ?, ?, ?)`);
    for (let i = 1; i <= 500; i++) {
      appt.run(i, dentistId, todayIso, `${String(8 + (i % 10)).padStart(2, '0')}:${i % 2 ? '00' : '30'}`, userId, now, now);
    }
  })();
  return { ms: Date.now() - t0 };
}

describe('scale: 20,000 synthetic patients', () => {
  it('seeds, pages, searches and summarises within budget', () => {
    const { ms: seedMs } = seed();
    const ctx = ownerCtx(env);

    const t1 = Date.now();
    const page = listPatients(ctx, { range: 'all', page: 200, pageSize: 50 });
    const pageMs = Date.now() - t1;
    expect(page.total).toBe(PATIENTS);
    expect(page.items).toHaveLength(50);

    const t2 = Date.now();
    const hits = globalSearch(ctx, 'Synthetic Patient 19999');
    const searchMs = Date.now() - t2;
    expect(hits.some((h) => h.kind === 'patient')).toBe(true);

    const t3 = Date.now();
    const dash = getDashboard(ctx);
    const dashMs = Date.now() - t3;
    expect(dash.todayAppointments).toBeGreaterThan(0);

    const t4 = Date.now();
    const agenda = listAgenda(ctx, { view: 'today' });
    const agendaMs = Date.now() - t4;
    expect(agenda.length).toBeGreaterThan(0);

    console.log(`[scale-20k] seed=${seedMs}ms page=${pageMs}ms search=${searchMs}ms dashboard=${dashMs}ms agenda=${agendaMs}ms`);
    expect(pageMs).toBeLessThan(1500);
    expect(searchMs).toBeLessThan(2000);
    expect(dashMs).toBeLessThan(3000);
    expect(agendaMs).toBeLessThan(2000);
  }, 180_000);
});
