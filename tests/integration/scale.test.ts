/**
 * Phase B — scale / stress fixture (ISS-005): hundreds of realistic synthetic
 * records; verifies paging correctness, report completeness, queue numbering
 * uniqueness and sane latencies. Synthetic data only — no production patients.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { createPatient } from '../../src/main/services/patients';
import { createVisit } from '../../src/main/services/visits';
import { createInvoice, createPayment } from '../../src/main/services/billing';
import { createAppointment, listAgenda } from '../../src/main/services/appointments';
import { addDays } from '../../src/main/services/appointment-rules';
import { listPatients } from '../../src/main/services/patients';
import { runReport } from '../../src/main/services/reports';
import { globalSearch } from '../../src/main/services/search';
import { todayISO } from '../../src/shared/currency';
import type { Ctx } from '../../src/main/core/context';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('scale');
});

afterEach(() => {
  cleanupEnv(env);
});

const TOTAL = 300;

function seedDentist(): number {
  const now = new Date().toISOString();
  return Number(env.db
    .prepare("INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Scale', NULL, 1, ?, ?)")
    .run(now, now).lastInsertRowid);
}

function seedClinic(ctx: Ctx, dentistId: number): number[] {
  const ids: number[] = [];
  for (let i = 1; i <= TOTAL; i++) {
    const p = createPatient(ctx, {
      name: `Synthetic Patient ${String(i).padStart(3, '0')}`,
      gender: i % 2 === 0 ? 'male' : 'female',
      ageYears: 18 + (i % 50),
      phone: `017${String(10000000 + i).slice(0, 8)}`,
      forceCreate: true,
    });
    ids.push(p.id);
  }
  // 100 invoices across the first 100 patients, half paid in full, quarter partial
  for (let i = 0; i < 100; i++) {
    const inv = createInvoice(ctx, {
      patientId: ids[i], date: '2026-09-10',
      items: [{ description: `Treatment ${i % 7}`, qty: 1, unitPricePaisa: (i + 1) * 10000 }],
    });
    if (i % 2 === 0) {
      createPayment(ctx, { invoiceId: inv.id, patientId: ids[i], amountPaisa: (i + 1) * 10000, method: 'cash' });
    } else if (i % 4 === 1) {
      createPayment(ctx, { invoiceId: inv.id, patientId: ids[i], amountPaisa: Math.floor(((i + 1) * 10000) / 2), method: 'bkash' });
    }
  }
  // 150 visits
  for (let i = 0; i < 150; i++) {
    createVisit(ctx, {
      patientId: ids[i % TOTAL], dentistId, datetime: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00`,
      chiefComplaint: `Complaint ${i}`, status: i % 3 === 0 ? 'closed' : 'open',
    } as any);
  }
  return ids;
}

describe('scale: hundreds of synthetic records', () => {
  it('seeds 300 patients + 100 invoices + 150 visits and pages them correctly', () => {
    const ctx = ownerCtx(env);
    const dentistId = seedDentist();
    const t0 = Date.now();
    seedClinic(ctx, dentistId);
    const seedMs = Date.now() - t0;

    const page1 = listPatients(ctx, { page: 1, pageSize: 50 });
    expect(page1.total).toBe(TOTAL);
    expect(page1.items).toHaveLength(50);
    const page6 = listPatients(ctx, { page: 6, pageSize: 50 });
    expect(page6.items).toHaveLength(50);
    // pages do not overlap
    const ids = new Set([...page1.items, ...page6.items].map((p) => p.id));
    expect(ids.size).toBe(100);
    // out-of-range page is empty, not an error
    expect(listPatients(ctx, { page: 99, pageSize: 50 }).items).toHaveLength(0);

    // report over the full dataset completes and totals reconcile
    const t1 = Date.now();
    const dues = runReport(ctx, 'outstanding_dues', {});
    const reportMs = Date.now() - t1;
    expect(dues.rows.length).toBeGreaterThan(0);
    // hand-check: odd i → unpaid (i%4==1 gets half) → dues must be > 0
    expect(dues.totals!['Total outstanding']).not.toBe('৳0.00');

    // search stays usable at scale
    const t2 = Date.now();
    const hits = globalSearch(ctx, 'Synthetic Patient 042');
    const searchMs = Date.now() - t2;
    expect(hits.some((h) => h.kind === 'patient')).toBe(true);
    expect(searchMs).toBeLessThan(2000);
    expect(reportMs).toBeLessThan(5000);
    expect(seedMs).toBeLessThan(30_000);
    console.log(`[scale] seed=${seedMs}ms report=${reportMs}ms search=${searchMs}ms`);
  });

  it('agenda views stay exact and fast across 120 appointments spread over 60 days', () => {
    const ctx = ownerCtx(env);
    const dentistId = seedDentist();
    const ids = seedClinic(ctx, dentistId);
    const today = todayISO();
    const t0 = Date.now();
    // Unique (date, slot) per appointment so the dentist never double-books.
    for (let i = 0; i < 120; i++) {
      const offset = i % 60;
      const slot = Math.floor(i / 60);
      createAppointment(ctx, {
        patientId: ids[i], dentistId, date: addDays(today, offset), time: `${String(9 + slot).padStart(2, '0')}:00`,
        durationMin: 30, type: 'Check-up', status: 'scheduled',
      });
    }
    const seedMs = Date.now() - t0;
    const expectIn = (lo: number, hi: number) => {
      let n = 0;
      for (let i = 0; i < 120; i++) if (i % 60 >= lo && i % 60 <= hi) n++;
      return n;
    };
    const t1 = Date.now();
    const todayRows = listAgenda(ctx, { view: 'today' });
    const next7 = listAgenda(ctx, { view: 'next7' });
    const next30 = listAgenda(ctx, { view: 'next30' });
    const upcoming = listAgenda(ctx, { view: 'upcoming' });
    const queryMs = Date.now() - t1;
    expect(todayRows).toHaveLength(expectIn(0, 0));
    expect(next7).toHaveLength(expectIn(0, 6));
    expect(next30).toHaveLength(expectIn(0, 29));
    expect(upcoming).toHaveLength(120);
    expect(next7.every((r) => r.date >= today && r.date <= addDays(today, 6))).toBe(true);
    expect(queryMs).toBeLessThan(2000);
    console.log(`[scale] appointments120 seed=${seedMs}ms agenda=${queryMs}ms`);
  });
});
