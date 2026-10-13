/**
 * Phase A static-audit findings (docs/V1.1_ISSUE_REGISTER.md ISS-020+).
 *
 * ISS-020 (P1): The Reports page offers 14 report names; the reports service
 * implemented a different, disjoint set of keys — every report launched from
 * the UI threw `Unknown report`. Root cause: UI/service contract was never
 * aligned and no test referenced `runReport` at all.
 *
 * This file locks the contract: every name the renderer offers must resolve
 * and execute at the service layer (the single source of truth is now
 * src/shared/reports.ts, imported by BOTH sides).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { runReport, reportCsv, REPORT_NAMES } from '../../src/main/services/reports';
import { createPatient } from '../../src/main/services/patients';
import { UI_REPORT_NAMES } from '../../src/shared/reports';
import type { Ctx } from '../../src/main/core/context';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('phase-a-findings');
});

afterEach(() => {
  cleanupEnv(env);
});

describe('ISS-020 report contract: UI names must run', () => {
  it('every report name the renderer offers resolves in the service', () => {
    for (const name of UI_REPORT_NAMES) {
      expect(REPORT_NAMES, `service must register report "${name}"`).toContain(name);
    }
  });

  it('runs every UI report end-to-end (owner, full-year range)', () => {
    const ctx = ownerCtx(env);
    const params = { from: '2026-01-01', to: '2026-12-31' };
    for (const name of UI_REPORT_NAMES) {
      let result: ReturnType<typeof runReport> | undefined;
      expect(() => {
        result = runReport(ctx, name, params);
      }, `report "${name}" must execute`).not.toThrow();
      expect(result, name).toBeTruthy();
      expect(result!.title.length, `${name} title`).toBeGreaterThan(0);
      expect(Array.isArray(result!.rows), `${name} rows`).toBe(true);
      expect(result!.generatedAt, `${name} generatedAt`).toBeTruthy();
    }
  });

  it('CSV export runs for every UI report name', () => {
    const ctx = ownerCtx(env);
    for (const name of UI_REPORT_NAMES) {
      expect(() => reportCsv(ctx, name, { from: '2026-01-01', to: '2026-12-31' }), `csv "${name}"`).not.toThrow();
    }
  });

  it('unknown names still fail fast with a clear error', () => {
    const ctx = ownerCtx(env);
    expect(() => runReport(ctx, 'not_a_real_report')).toThrow(/Unknown report/);
  });

  it('report permissions are enforced at the service layer (UI-only gating is not enough)', () => {
    // A viewer with NO permissions at all must be denied every report.
    const viewer = { db: env.db, paths: env.paths, session: sessionWith([]) };
    for (const name of UI_REPORT_NAMES) {
      expect(() => runReport(viewer, name, { from: '2026-01-01', to: '2026-12-31' }), `perm "${name}"`).toThrow();
    }
  });
});

describe('ISS-020 payment report robustness', () => {
  it('payments report handles an unbounded range without SQL errors', () => {
    const ctx = ownerCtx(env);
    // range 'all' resolves to no date bounds — the By-method query used to
    // concatenate `AND type=...` onto an empty WHERE clause (syntax error).
    expect(() => runReport(ctx, 'collection_report', { range: 'all' })).not.toThrow();
    expect(() => runReport(ctx, 'payment_methods', { range: 'all' })).not.toThrow();
  });
});

import { createAppointment, updateAppointment } from '../../src/main/services/appointments';
import { todayISO } from '../../src/shared/currency';

function seedDentist(t: TestEnv): number {
  const now = new Date().toISOString();
  const info = t.db
    .prepare("INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Sync', NULL, 1, ?, ?)")
    .run(now, now);
  return Number(info.lastInsertRowid);
}

function patientOf(ctx: Ctx) {
  return createPatient(ctx, { name: 'Sync Patient', gender: 'male', ageYears: 30, phone: '01799990001', forceCreate: true });
}

/*
 * ---------------------------------------------------------------------------
 * ISS-023 (P3): reschedule conflict check did not exclude the appointment's
 * own row → extending duration in place was blocked by a self-conflict.
 * ISS-024 (P2): plain update path only re-checked conflicts when date/time/
 * dentist changed — a duration-only change could silently double-book.
 * ---------------------------------------------------------------------------
 */
describe('ISS-023/024 appointment conflict checks', () => {
  it('duration-only update is conflict-checked (cannot silently overlap a neighbour)', () => {
    const ctx = ownerCtx(env);
    const p = patientOf(ctx);
    const d = seedDentist(env);
    const a = createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '15:00', durationMin: 30, type: 'consultation' });
    createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '15:30', durationMin: 30, type: 'consultation' });
    // Extending A to 60 min overlaps the 15:30 appointment → must be rejected.
    expect(() => updateAppointment(ctx, a.id, { durationMin: 60 })).toThrow(/overlap|overlaps/i);
  });

  it('rescheduling to the same slot with a longer duration is NOT blocked by the appointment itself', () => {
    const ctx = ownerCtx(env);
    const p = patientOf(ctx);
    const d = seedDentist(env);
    const a = createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '16:00', durationMin: 30, type: 'consultation' });
    let err: any = null;
    try {
      updateAppointment(ctx, a.id, { reschedule: { date: todayISO(), time: '16:00', durationMin: 60 } });
    } catch (e) { err = e; }
    expect(err, `self-conflict blocked a legitimate reschedule: ${err?.message}`).toBeNull();
  });
});
