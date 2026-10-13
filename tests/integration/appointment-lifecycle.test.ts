/**
 * Appointment lifecycle (reminder-only schedule).
 *
 * - Open appointments dated before the local calendar day expire automatically.
 *   A Saturday appointment is active all of Saturday and expires at local midnight
 *   that starts Sunday. The boundary is tested with a fake clock set to local times.
 * - Expiry is idempotent and restart-safe: repeated or post-restart runs change nothing
 *   and write a single audit row per effective run.
 * - Reschedules keep the same row, require explicit confirmation and are audited.
 * - Deleting an appointment never touches the patient, visits, or invoices.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { createPatient } from '../../src/main/services/patients';
import {
  createAppointment, deleteAppointment, getAppointment, listAgenda, runAppointmentExpiry, updateAppointment,
} from '../../src/main/services/appointments';
import { isExpiredOn, reminderKindFor, agendaRange, addDays, weekdayOf } from '../../src/main/services/appointment-rules';
import { syncAppointmentReminders } from '../../src/main/services/notifications';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('appointment-lifecycle');
});

afterEach(() => {
  vi.useRealTimers();
  cleanupEnv(env);
});

/** Local-time Date at the given wall-clock time (independent of the process timezone). */
function local(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0, ms = 0): Date {
  return new Date(y, m - 1, d, hh, mm, ss, ms);
}

function setClock(d: Date): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(d);
}

function seedPatientAndDentist() {
  const ctx = ownerCtx(env);
  const p = createPatient(ctx, { name: 'Lifecycle Patient', gender: 'female', ageYears: 40, phone: '01711000111', forceCreate: true });
  const now = new Date().toISOString();
  const dentistId = Number(env.db
    .prepare("INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Life', NULL, 1, ?, ?)")
    .run(now, now).lastInsertRowid);
  return { ctx, patientId: p.id, dentistId };
}

// Oct 2026: Sat 17, Sun 18, Mon 19. Verified below so the test cannot silently drift.
const SAT = '2026-10-17';
const SUN = '2026-10-18';
const MON = '2026-10-19';

describe('calendar assumptions', () => {
  it('Oct 17 2026 is a Saturday and Oct 18 is the following Sunday', () => {
    expect(weekdayOf(SAT)).toBe(6);
    expect(weekdayOf(SUN)).toBe(0);
    expect(addDays(SAT, 1)).toBe(SUN);
  });
});

describe('expiry rule (pure)', () => {
  it('an appointment is active on its own day and expired the day after', () => {
    expect(isExpiredOn(SAT, SAT)).toBe(false);
    expect(isExpiredOn(SAT, SUN)).toBe(true);
    expect(isExpiredOn(SAT, MON)).toBe(true);
    expect(isExpiredOn(SUN, SAT)).toBe(false);
  });

  it('reminders exist only for today and tomorrow, never for expired days', () => {
    expect(reminderKindFor(SAT, SAT)).toBe('today');
    expect(reminderKindFor(SUN, SAT)).toBe('tomorrow');
    expect(reminderKindFor(MON, SAT)).toBeNull();
    expect(reminderKindFor(SAT, SUN)).toBeNull();
  });

  it('agenda ranges are inclusive windows from today', () => {
    expect(agendaRange('today', SAT)).toEqual({ from: SAT, to: SAT });
    expect(agendaRange('next7', SAT)).toEqual({ from: SAT, to: addDays(SAT, 6) });
    expect(agendaRange('next30', SAT)).toEqual({ from: SAT, to: addDays(SAT, 29) });
    expect(agendaRange('upcoming', SAT).to).toBeNull();
  });
});

describe('Saturday appointment expires at local midnight into Sunday', () => {
  it('stays open through 23:59:59.999 Saturday and expires at 00:00:00 Sunday', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 16, 12, 0)); // Friday noon
    const appt = createAppointment(ctx, { patientId, dentistId, date: SAT, time: '10:00', durationMin: 30, type: 'Check-up' });

    setClock(local(2026, 10, 17, 23, 59, 59, 999)); // last millisecond of Saturday
    expect(runAppointmentExpiry(env.db)).toBe(0);
    expect(getAppointment(ctx, appt.id).timing).toBe('today');
    expect(getAppointment(ctx, appt.id).expiredAt).toBeNull();

    setClock(local(2026, 10, 18, 0, 0, 0, 0)); // local midnight starting Sunday
    expect(runAppointmentExpiry(env.db)).toBe(1);
    const after = getAppointment(ctx, appt.id);
    expect(after.timing).toBe('expired');
    expect(after.expiredAt).not.toBeNull();
    // Status stays 'scheduled' (history is kept; expiry is a flag, not a cancellation).
    expect(after.status).toBe('scheduled');
  });

  it('is idempotent: repeated runs change nothing and write one audit row', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 16, 12, 0));
    const appt = createAppointment(ctx, { patientId, dentistId, date: SAT, time: '11:00', durationMin: 30, type: 'Check-up' });
    setClock(local(2026, 10, 18, 9, 0));
    expect(runAppointmentExpiry(env.db)).toBe(1);
    const first = getAppointment(ctx, appt.id).expiredAt;
    expect(runAppointmentExpiry(env.db)).toBe(0);
    expect(runAppointmentExpiry(env.db)).toBe(0);
    expect(getAppointment(ctx, appt.id).expiredAt).toBe(first);
    const audits = env.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'appointment.expire'").get() as { c: number };
    expect(Number(audits.c)).toBe(1);
  });

  it('is restart-safe: a run after a simulated restart on the same database resumes correctly', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 16, 12, 0));
    const sat = createAppointment(ctx, { patientId, dentistId, date: SAT, time: '09:00', durationMin: 30, type: 'Check-up' });
    const mon = createAppointment(ctx, { patientId, dentistId, date: MON, time: '09:00', durationMin: 30, type: 'Check-up' });
    // App starts Sunday morning after being closed since Friday: expiry runs on startup.
    setClock(local(2026, 10, 18, 8, 30));
    expect(runAppointmentExpiry(env.db)).toBe(1);
    expect(getAppointment(ctx, sat.id).timing).toBe('expired');
    expect(getAppointment(ctx, mon.id).timing).toBe('upcoming');
  });

  it('agenda never lists expired rows and marks them expired on first read', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 16, 12, 0));
    createAppointment(ctx, { patientId, dentistId, date: SAT, time: '10:00', durationMin: 30, type: 'Check-up' });
    setClock(local(2026, 10, 18, 0, 0));
    const upcoming = listAgenda(ctx, { view: 'upcoming' });
    expect(upcoming.some((r) => r.date === SAT)).toBe(false);
    const row = env.db.prepare("SELECT expired_at FROM appointments WHERE date = ?").get(SAT) as { expired_at: string | null };
    expect(row.expired_at).not.toBeNull();
  });
});

describe('reschedule Saturday to Monday', () => {
  it('needs explicit confirmation, keeps the same row, re-activates, and is audited', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 16, 12, 0));
    const appt = createAppointment(ctx, { patientId, dentistId, date: SAT, time: '10:00', durationMin: 30, type: 'Check-up' });
    setClock(local(2026, 10, 18, 9, 0));
    runAppointmentExpiry(env.db);
    expect(getAppointment(ctx, appt.id).timing).toBe('expired');

    expect(() => updateAppointment(ctx, appt.id, { date: MON, time: '10:00' })).toThrow(/confirm/i);
    const moved = updateAppointment(ctx, appt.id, { date: MON, time: '11:00', confirmReschedule: true });
    expect(moved.id).toBe(appt.id);
    expect(moved.date).toBe(MON);
    expect(moved.time).toBe('11:00');
    expect(moved.timing).toBe('upcoming');
    expect(moved.expiredAt).toBeNull();

    const count = env.db.prepare('SELECT COUNT(*) c FROM appointments WHERE patient_id = ?').get(patientId) as { c: number };
    expect(Number(count.c), 'reschedule must not duplicate the appointment').toBe(1);
    const audit = env.db.prepare("SELECT summary FROM audit_log WHERE action = 'appointment.reschedule' AND entity_id = ?")
      .get(String(appt.id)) as { summary: string };
    expect(audit.summary).toContain(SAT);
    expect(audit.summary).toContain(MON);
  });

  it('rejects moving an appointment into the past', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 16, 12, 0));
    const appt = createAppointment(ctx, { patientId, dentistId, date: MON, time: '10:00', durationMin: 30, type: 'Check-up' });
    setClock(local(2026, 10, 19, 8, 0)); // Monday morning: Saturday is now in the past
    expect(() => updateAppointment(ctx, appt.id, { date: SAT, time: '10:00', confirmReschedule: true })).toThrow(/later date|today/i);
  });

  it('editing notes of an expired appointment does NOT silently re-activate it', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 16, 12, 0));
    const appt = createAppointment(ctx, { patientId, dentistId, date: SAT, time: '10:00', durationMin: 30, type: 'Check-up' });
    setClock(local(2026, 10, 18, 9, 0));
    runAppointmentExpiry(env.db);
    const edited = updateAppointment(ctx, appt.id, { notes: 'Called patient, will reschedule' });
    expect(edited.timing).toBe('expired');
    expect(edited.expiredAt).not.toBeNull();
  });

  it('rejects creating an appointment in the past but allows today', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 18, 9, 0));
    expect(() => createAppointment(ctx, { patientId, dentistId, date: SAT, time: '10:00', durationMin: 30, type: 'Check-up' })).toThrow(/later date|today/i);
    expect(() => createAppointment(ctx, { patientId, dentistId, date: SUN, time: '10:00', durationMin: 30, type: 'Check-up' })).not.toThrow();
  });
});

describe('legacy statuses and deletion', () => {
  it('legacy open statuses (arrived / in_queue / in_treatment) also expire; closed statuses are untouched', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    const now = new Date().toISOString();
    const insert = env.db.prepare(
      `INSERT INTO appointments (patient_id, dentist_id, date, time, duration_min, type, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, '09:00', 30, 'Legacy', ?, 1, ?, ?)`,
    );
    for (const status of ['arrived', 'in_queue', 'in_treatment', 'completed', 'cancelled', 'no_show']) {
      insert.run(patientId, dentistId, '2026-10-01', status, now, now);
    }
    setClock(local(2026, 10, 18, 9, 0));
    expect(runAppointmentExpiry(env.db)).toBe(3);
    const rows = env.db.prepare("SELECT status, expired_at FROM appointments WHERE date = '2026-10-01' ORDER BY status").all() as { status: string; expired_at: string | null }[];
    const expired = rows.filter((r) => r.expired_at !== null).map((r) => r.status).sort();
    expect(expired).toEqual(['arrived', 'in_queue', 'in_treatment']);
    void ctx;
  });

  it('manual delete hides the appointment, keeps the patient and writes no visit or invoice', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 16, 12, 0));
    const appt = createAppointment(ctx, { patientId, dentistId, date: MON, time: '10:00', durationMin: 30, type: 'Check-up' });
    const countOf = (sql: string) => Number((env.db.prepare(sql).get() as { c: number }).c);
    const before = { visits: countOf('SELECT COUNT(*) c FROM visits'), invoices: countOf('SELECT COUNT(*) c FROM invoices') };
    expect(deleteAppointment(ctx, appt.id)).toEqual({ ok: true });
    expect(listAgenda(ctx, { view: 'upcoming' }).some((r) => r.id === appt.id)).toBe(false);
    expect(() => getAppointment(ctx, appt.id)).toThrow(/not found/i);
    expect(countOf('SELECT COUNT(*) c FROM patients WHERE deleted_at IS NULL')).toBeGreaterThan(0);
    expect({ visits: countOf('SELECT COUNT(*) c FROM visits'), invoices: countOf('SELECT COUNT(*) c FROM invoices') }).toEqual(before);
    expect(() => deleteAppointment(ctx, appt.id)).toThrow(/not found/i);
  });
});

describe('appointment reminders follow the schedule', () => {
  it('creates reminders for today and tomorrow only, dismisses reminders for moved appointments, and never reminds about expired ones', () => {
    const { ctx, patientId, dentistId } = seedPatientAndDentist();
    setClock(local(2026, 10, 17, 8, 0)); // Saturday morning
    const today = createAppointment(ctx, { patientId, dentistId, date: SAT, time: '10:00', durationMin: 30, type: 'Check-up' });
    const tomorrow = createAppointment(ctx, { patientId, dentistId, date: SUN, time: '10:00', durationMin: 30, type: 'Check-up' });
    const later = createAppointment(ctx, { patientId, dentistId, date: MON, time: '10:00', durationMin: 30, type: 'Check-up' });

    expect(syncAppointmentReminders(env.db, SAT, true)).toBe(2);
    expect(syncAppointmentReminders(env.db, SAT, true)).toBe(0); // idempotent
    const keys = (env.db.prepare("SELECT key FROM notifications WHERE kind = 'appointments' AND read_at IS NULL").all() as { key: string }[]).map((r) => r.key);
    expect(keys.some((k) => k.startsWith(`appt:${today.id}:`))).toBe(true);
    expect(keys.some((k) => k.startsWith(`appt:${tomorrow.id}:`))).toBe(true);
    expect(keys.some((k) => k.startsWith(`appt:${later.id}:`))).toBe(false);

    // Staff moves tomorrow's appointment away; the stale reminder is dismissed on the next sync.
    updateAppointment(ctx, tomorrow.id, { date: MON, time: '11:00', confirmReschedule: true });
    syncAppointmentReminders(env.db, SAT, true);
    const stillUnread = (env.db.prepare("SELECT key FROM notifications WHERE kind = 'appointments' AND read_at IS NULL").all() as { key: string }[]).map((r) => r.key);
    expect(stillUnread.some((k) => k.startsWith(`appt:${tomorrow.id}:`))).toBe(false);

    // Disabled preference: no new reminders and all open ones are dismissed.
    syncAppointmentReminders(env.db, SAT, false);
    const disabled = env.db.prepare("SELECT COUNT(*) c FROM notifications WHERE kind = 'appointments' AND read_at IS NULL").get() as { c: number };
    expect(Number(disabled.c)).toBe(0);
  });
});
