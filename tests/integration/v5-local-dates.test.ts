/**
 * v5 Phase 2 — V5-012: local calendar days vs stored instants.
 *
 * The clinic computer runs on Asia/Dhaka (UTC+6, no DST). Payments are stored
 * as UTC instants; visit times are stored as local wall-clock time. Reports,
 * filters and the dashboard must all count by the clinic's local day.
 */
process.env.TZ = 'Asia/Dhaka';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { runReport } from '../../src/main/services/reports';
import { createPatient } from '../../src/main/services/patients';
import { createVisit } from '../../src/main/services/visits';
import { getDashboard } from '../../src/main/services/dashboard';
import { instantRange, localDateTimeLabel, localDayEndUtc, localDayStartUtc, localMonthOf } from '../../src/main/core/dates';
import { todayISO } from '../../src/shared/currency';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('v5-dates');
});

afterEach(() => {
  cleanupEnv(env);
});

function addPayment(patientId: number, paidAtUtc: string, amountPaisa: number, type: 'payment' | 'refund' = 'payment'): void {
  env.db.prepare(
    `INSERT INTO payments (invoice_id, patient_id, amount_paisa, method, reference, type, received_by, paid_at, note, created_at)
     VALUES (NULL, ?, ?, 'cash', NULL, ?, 1, ?, NULL, ?)`,
  ).run(patientId, amountPaisa, type, paidAtUtc, paidAtUtc);
}

describe('local-day helpers', () => {
  it('converts Dhaka calendar days to UTC instants', () => {
    expect(new Date('2026-03-10T18:00:00.000Z').getHours()).toBe(0); // sanity: TZ applied
    expect(localDayStartUtc('2026-03-11')).toBe('2026-03-10T18:00:00.000Z');
    expect(localDayEndUtc('2026-03-11')).toBe('2026-03-11T17:59:59.999Z');
    expect(localDateTimeLabel('2026-03-10T20:30:00.000Z')).toBe('2026-03-11 02:30');
    expect(localMonthOf('2026-03-31T19:00:00.000Z')).toBe('2026-04');
    expect(instantRange('paid_at', '2026-03-11', null)).toEqual({ conds: ['paid_at >= ?'], args: ['2026-03-10T18:00:00.000Z'] });
    expect(() => localDayStartUtc('2026-02-31')).toThrow(/valid calendar date/);
    expect(() => instantRange('paid_at', 'yesterday', null)).toThrow(/YYYY-MM-DD/);
  });
});

describe('financial reports count by the clinic’s local day', () => {
  it('collection report, daily summary and monthly revenue agree on the local day', () => {
    const owner = ownerCtx(env);
    const p = createPatient(owner, { name: 'Night Patient', gender: 'female', ageYears: 30, phone: '01733333333' });
    addPayment(p.id, '2026-03-10T17:30:00.000Z', 10000); // 10 Mar 23:30 local
    addPayment(p.id, '2026-03-10T20:30:00.000Z', 25000); // 11 Mar 02:30 local
    addPayment(p.id, '2026-03-11T19:00:00.000Z', 40000); // 12 Mar 01:00 local
    addPayment(p.id, '2026-03-31T19:00:00.000Z', 70000); // 1 Apr 01:00 local

    const day = runReport(owner, 'collection_report', { from: '2026-03-11', to: '2026-03-11' });
    expect(day.rows).toHaveLength(1);
    expect(day.rows[0].time).toBe('2026-03-11 02:30');

    const summary = runReport(owner, 'daily_summary', { from: '2026-03-11', to: '2026-03-11' });
    const collected = JSON.stringify(summary);
    expect(collected).toContain('250.00');
    expect(collected).not.toContain('350.00');

    const months = runReport(owner, 'monthly_revenue', { from: '2026-03-01', to: '2026-04-30' });
    const april = months.rows.find((r) => r.month === '2026-04');
    const march = months.rows.find((r) => r.month === '2026-03');
    expect(april?.collected).toBe('৳700.00');
    expect(march?.collected).toBe('৳750.00');

    const methods = runReport(owner, 'payment_methods', { from: '2026-03-10', to: '2026-03-10' });
    expect(methods.rows[0]).toMatchObject({ method: 'cash', paid: '৳100.00', entries: 1 });
  });
});

describe('visit times are local wall-clock time', () => {
  it('a visit at 20:30 local counts for today on the dashboard', () => {
    const owner = ownerCtx(env);
    const p = createPatient(owner, { name: 'Evening Patient', gender: 'male', ageYears: 41, phone: '01744444444', registrationDate: '2020-01-01' } as any);
    const before = getDashboard(owner).todayPatients;
    createVisit(owner, { patientId: p.id, datetime: `${todayISO()}T20:30` } as any);
    expect(getDashboard(owner).todayPatients).toBe(before + 1);
  });

  it('a visit without an explicit time is stored as the current local wall-clock time', () => {
    const owner = ownerCtx(env);
    const p = createPatient(owner, { name: 'Walk-in', gender: 'female', ageYears: 22, phone: '01755555555' });
    const v = createVisit(owner, { patientId: p.id } as any);
    expect(v.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    expect(v.datetime.slice(0, 10)).toBe(todayISO());
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const stored = v.datetime.slice(11, 16);
    // Allow a minute boundary between creation and assertion.
    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    expect(Math.abs(minutes(stored) - minutes(hhmm)) <= 1 || Math.abs(minutes(stored) - minutes(hhmm)) === 1439).toBe(true);
  });
});
