import type { DB } from '../db/database';
import type { Ctx } from '../core/context';
import type { AppointmentDTO, AppointmentInput, AppointmentAgendaFilter, AppointmentStatus } from '../../shared/types';
import { conflict, forbidden, notFound, validation } from '../errors';
import { audit, hasPermission, requirePermission, tx } from '../core/context';
import { nowISO, todayISO } from '../../shared/currency';
import { escapeLike, optString, reqDate, reqInt, reqString, reqTime, oneOf } from '../core/validate';
import {
  ALL_OPEN_STATUSES,
  agendaRange,
  isExpiredOn,
  isOpenStatus,
  overlaps,
  type AgendaView,
} from './appointment-rules';

/**
 * Appointments are a reminder-only schedule. Creating, rescheduling or deleting
 * an appointment NEVER creates a visit, invoice, payment, treatment record or
 * any other clinical or financial row. See docs/APPOINTMENTS.md.
 */

export interface ApptRow {
  id: number; patient_id: number; patient_name: string; patient_code: string; phone: string | null;
  dentist_id: number | null; dentist_name: string | null; date: string; time: string;
  duration_min: number; type: string; status: string; notes: string | null; planned_treatments: string | null;
  created_by: number; created_at: string; updated_at: string; visit_id: number | null;
  expired_at: string | null; deleted_at: string | null;
}

/** Shared row shape + joins. Keep dashboard and notification queries in step with this. */
export const SELECT_APPT = `
  SELECT a.*, p.name patient_name, p.code patient_code, p.phone phone, d.name dentist_name
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  LEFT JOIN dentists d ON d.id = a.dentist_id`;

/** Active = not deleted and not expired. Expiry is also re-derived from the date at read time. */
export const ACTIVE_APPOINTMENT_SQL = 'a.deleted_at IS NULL AND a.expired_at IS NULL';

/** Single row→DTO mapping used by every appointment read path (agenda, dashboard, history). */
export function toDTO(r: ApptRow, today: string): AppointmentDTO {
  const expired = r.expired_at !== null || (isOpenStatus(r.status) && isExpiredOn(r.date, today));
  let timing: AppointmentDTO['timing'];
  if (expired) timing = 'expired';
  else if (r.date === today) timing = 'today';
  else if (r.date > today) timing = 'upcoming';
  else timing = 'closed';
  return {
    id: r.id, patientId: r.patient_id, patientName: r.patient_name, patientCode: r.patient_code,
    phone: r.phone, dentistId: r.dentist_id, dentistName: r.dentist_name,
    date: r.date, time: r.time, durationMin: r.duration_min, type: r.type,
    status: r.status as AppointmentStatus, notes: r.notes, plannedTreatments: r.planned_treatments,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, visitId: r.visit_id,
    expiredAt: r.expired_at, timing, legacyStatus: ['arrived', 'in_queue', 'in_treatment'].includes(r.status),
  };
}

function getRow(db: DB, id: number): ApptRow | undefined {
  return db.prepare(`${SELECT_APPT} WHERE a.id = ? AND a.deleted_at IS NULL`).get(id) as ApptRow | undefined;
}

function getOne(ctx: Ctx, id: number): AppointmentDTO {
  const row = getRow(ctx.db, id);
  if (!row) throw notFound('Appointment not found.');
  return toDTO(row, todayISO());
}

/**
 * Expire every undeleted open appointment whose date is before today's local date.
 * Idempotent: rows already expired are not touched again. Safe to run at startup,
 * on a timer and before every agenda read; it never deletes data.
 */
export function runAppointmentExpiry(db: DB, today: string = todayISO(), at: string = nowISO()): number {
  const placeholders = ALL_OPEN_STATUSES.map(() => '?').join(',');
  const info = db
    .prepare(
      `UPDATE appointments SET expired_at = ?, updated_at = ?
       WHERE deleted_at IS NULL AND expired_at IS NULL AND date < ? AND status IN (${placeholders})`,
    )
    .run(at, at, today, ...ALL_OPEN_STATUSES);
  if (info.changes > 0) {
    audit({ db }, {
      action: 'appointment.expire', entityType: 'appointment', entityId: null,
      summary: `${info.changes} open appointment(s) expired automatically (dated before ${today})`,
    });
  }
  return info.changes;
}

interface ConflictInfo { id: number; time: string; durationMin: number; patientName: string }

function findConflict(db: DB, dentistId: number, date: string, time: string, durationMin: number, excludeId?: number): ConflictInfo | null {
  const placeholders = ALL_OPEN_STATUSES.map(() => '?').join(',');
  const params: unknown[] = [dentistId, date, ...ALL_OPEN_STATUSES];
  let sql = `SELECT a.id, a.time, a.duration_min, p.name patient_name FROM appointments a JOIN patients p ON p.id = a.patient_id
     WHERE a.dentist_id = ? AND a.date = ? AND a.status IN (${placeholders}) AND a.deleted_at IS NULL AND a.expired_at IS NULL`;
  if (excludeId) { sql += ' AND a.id != ?'; params.push(excludeId); }
  const rows = db.prepare(sql).all(...(params as any[])) as { id: number; time: string; duration_min: number; patient_name: string }[];
  const candidate = { time, durationMin };
  for (const r of rows) {
    if (overlaps(candidate, { time: r.time, durationMin: r.duration_min })) {
      return { id: r.id, time: r.time, durationMin: r.duration_min, patientName: r.patient_name };
    }
  }
  return null;
}

function assertNotPast(date: string, today: string): void {
  if (date < today) throw validation('Appointments must be scheduled for today or a later date.');
}

function conflictMessage(c: ConflictInfo, canOverride: boolean): string {
  return canOverride
    ? `Time slot overlaps an existing appointment for this dentist (${c.time}, ${c.patientName}). Enable "Override conflict" to book anyway.`
    : `Time slot overlaps an existing appointment for this dentist (${c.time}, ${c.patientName}). Choose another time.`;
}

/* ------------------------------ queries ------------------------------- */

/** Date-range listing used by the calendar/history views. Includes expired and closed rows (flagged). */
export function listAppointments(ctx: Ctx, filter: { from: string; to: string; dentistId?: number; status?: string }): AppointmentDTO[] {
  requirePermission(ctx, 'appointments.view');
  const from = reqDate(filter?.from, 'From date');
  const to = reqDate(filter?.to, 'To date');
  if (from > to) throw validation('From date must be on or before the To date.');
  const where = ['a.date >= ?', 'a.date <= ?', 'a.deleted_at IS NULL'];
  const params: unknown[] = [from, to];
  if (filter.dentistId) { where.push('a.dentist_id = ?'); params.push(Number(filter.dentistId)); }
  if (filter.status && filter.status !== 'all') { where.push('a.status = ?'); params.push(filter.status); }
  const today = todayISO();
  const rows = ctx.db
    .prepare(`${SELECT_APPT} WHERE ${where.join(' AND ')} ORDER BY a.date, a.time LIMIT 2000`)
    .all(...(params as any[])) as ApptRow[];
  return rows.map((r) => toDTO(r, today));
}

/**
 * The agenda: active, undeleted, unexpired appointments from today onward,
 * optionally limited to a view window and filtered by dentist, status, reason
 * and patient search text. Expires stale rows first so the view is never stale.
 */
export function listAgenda(ctx: Ctx, filter: AppointmentAgendaFilter = { view: 'next7' }): AppointmentDTO[] {
  requirePermission(ctx, 'appointments.view');
  const today = todayISO();
  runAppointmentExpiry(ctx.db, today);
  const view = (['today', 'next7', 'next30', 'upcoming'] as const).includes(filter?.view as AgendaView)
    ? (filter.view as AgendaView)
    : 'next7';
  const range = agendaRange(view, today);

  const where = [ACTIVE_APPOINTMENT_SQL, 'a.date >= ?'];
  const params: unknown[] = [today];
  if (range.to) { where.push('a.date <= ?'); params.push(range.to); }
  if (filter.dentistId) { where.push('a.dentist_id = ?'); params.push(reqInt(filter.dentistId, 'Dentist', { min: 1 })); }
  if (filter.status && filter.status !== 'all') {
    const status = oneOf(filter.status, ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const, 'Status');
    where.push('a.status = ?'); params.push(status);
  } else {
    where.push(`a.status IN (${ALL_OPEN_STATUSES.map(() => '?').join(',')})`);
    params.push(...ALL_OPEN_STATUSES);
  }
  if (filter.reason && filter.reason.trim()) {
    where.push('a.type = ?'); params.push(reqString(filter.reason, 'Reason', { max: 80 }));
  }
  if (filter.search && filter.search.trim()) {
    const term = `%${escapeLike(filter.search.trim().slice(0, 80))}%`;
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\')");
    params.push(term, term);
  }
  const rows = ctx.db
    .prepare(`${SELECT_APPT} WHERE ${where.join(' AND ')} ORDER BY a.date, a.time, a.id LIMIT 1000`)
    .all(...(params as any[])) as ApptRow[];
  return rows.map((r) => toDTO(r, today));
}

export function getAppointment(ctx: Ctx, id: number): AppointmentDTO {
  requirePermission(ctx, 'appointments.view');
  return getOne(ctx, reqInt(id, 'Appointment', { min: 1 }));
}

/* ----------------------------- mutations ------------------------------ */

export function createAppointment(ctx: Ctx, raw: AppointmentInput): AppointmentDTO {
  requirePermission(ctx, 'appointments.manage');
  const patientId = reqInt(raw?.patientId, 'Patient', { min: 1 });
  const patient = ctx.db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!patient) throw notFound('Patient not found.');
  const today = todayISO();
  const date = reqDate(raw?.date, 'Date');
  assertNotPast(date, today);
  const time = reqTime(raw?.time, 'Time');
  const durationMin = reqInt(raw?.durationMin ?? 30, 'Duration', { min: 5, max: 720 });
  const dentistId = raw?.dentistId != null ? reqInt(raw.dentistId, 'Dentist', { min: 1 }) : null;
  const type = reqString(raw?.type ?? 'consultation', 'Reason for visit', { max: 80 });
  const status = raw?.status ? oneOf(raw.status, ['scheduled', 'confirmed'] as const, 'Status') : 'scheduled';
  const notes = optString(raw?.notes, 'Notes', { max: 4000 });
  const planned = optString(raw?.plannedTreatments, 'Planned treatments', { max: 2000 });

  const conflictInfo = dentistId != null ? findConflict(ctx.db, dentistId, date, time, durationMin) : null;
  if (conflictInfo && !raw.allowConflict) {
    throw conflict(conflictMessage(conflictInfo, hasPermission(ctx, 'appointments.override')));
  }
  if (conflictInfo && raw.allowConflict && !hasPermission(ctx, 'appointments.override')) {
    throw forbidden('Overriding appointment conflicts requires additional permission.');
  }

  const id = tx(ctx.db, () => {
    const now = nowISO();
    const info = ctx.db
      .prepare(
        `INSERT INTO appointments (patient_id, dentist_id, date, time, duration_min, type, status, notes, planned_treatments,
           created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(patientId, dentistId, date, time, durationMin, type, status, notes, planned, ctx.session.userId, now, now);
    const apptId = Number(info.lastInsertRowid);
    audit(ctx, {
      action: 'appointment.create', entityType: 'appointment', entityId: apptId,
      summary: `Appointment ${date} ${time} (${type})`,
      after: { date, time, dentistId, durationMin, conflictOverridden: !!conflictInfo && !!raw.allowConflict },
    });
    return apptId;
  });
  return getOne(ctx, id);
}

export interface AppointmentUpdate {
  status?: string;
  allowConflict?: boolean;
  dentistId?: number | null;
  date?: string;
  time?: string;
  durationMin?: number;
  notes?: string | null;
  plannedTreatments?: string | null;
  type?: string;
  /** Required when the date or time changes: the staff member confirmed the move. */
  confirmReschedule?: boolean;
  /** Reschedule payload (kept for the existing IPC shape). Same semantics as date/time/durationMin. */
  reschedule?: { date: string; time: string; durationMin?: number };
}

/**
 * Update an appointment IN PLACE. A reschedule keeps the same appointment id,
 * patient, reason, planned treatment and notes, so there is never a duplicate.
 * Moving the date or time is a material change and must be confirmed.
 */
export function updateAppointment(ctx: Ctx, id: number, input: AppointmentUpdate): AppointmentDTO {
  requirePermission(ctx, 'appointments.manage');
  const existing = ctx.db.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').get(id) as any | undefined;
  if (!existing) throw notFound('Appointment not found.');
  if (existing.status === 'completed') throw conflict('Completed appointments cannot be edited.');
  const today = todayISO();

  const source = input.reschedule
    ? { ...input, date: input.reschedule.date, time: input.reschedule.time, durationMin: input.reschedule.durationMin ?? input.durationMin }
    : input;

  const newDate = source.date !== undefined ? reqDate(source.date, 'Date') : existing.date;
  const newTime = source.time !== undefined ? reqTime(source.time, 'Time') : existing.time;
  const dentistId = source.dentistId !== undefined
    ? (source.dentistId != null ? reqInt(source.dentistId, 'Dentist', { min: 1 }) : null)
    : existing.dentist_id as number | null;
  const duration = source.durationMin != null ? reqInt(source.durationMin, 'Duration', { min: 5, max: 720 }) : existing.duration_min;
  const status = source.status !== undefined
    ? oneOf(source.status, ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const, 'Status')
    : existing.status;
  const type = source.type !== undefined ? reqString(source.type, 'Reason for visit', { max: 80 }) : existing.type;
  const notes = source.notes !== undefined ? optString(source.notes, 'Notes', { max: 4000 }) : existing.notes;
  const planned = source.plannedTreatments !== undefined
    ? optString(source.plannedTreatments, 'Planned treatments', { max: 2000 })
    : existing.planned_treatments;

  const timeChanged = newDate !== existing.date || newTime !== existing.time;
  const scheduleChanged = timeChanged || duration !== existing.duration_min || dentistId !== existing.dentist_id;

  if (timeChanged) {
    if (!isOpenStatus(existing.status)) {
      throw conflict(`A ${existing.status.replace('_', ' ')} appointment cannot be moved.`);
    }
    assertNotPast(newDate, today);
    if (source.confirmReschedule !== true) {
      throw validation(`Confirm the change to ${newDate} ${newTime} before saving.`, { code: 'RESCHEDULE_CONFIRMATION_REQUIRED' });
    }
  }

  if (scheduleChanged && dentistId != null) {
    const c = findConflict(ctx.db, dentistId, newDate, newTime, duration, id);
    if (c && !source.allowConflict) throw conflict(`New slot overlaps an existing appointment (${c.time}, ${c.patientName}).`);
    if (c && source.allowConflict && !hasPermission(ctx, 'appointments.override')) {
      throw forbidden('Overriding appointment conflicts requires additional permission.');
    }
  }

  tx(ctx.db, () => {
    const now = nowISO();
    // Moving an expired appointment to a current/future date re-activates it; other edits leave expiry untouched.
    ctx.db
      .prepare(
        `UPDATE appointments SET dentist_id = ?, date = ?, time = ?, duration_min = ?, status = ?, type = ?, notes = ?,
           planned_treatments = ?, expired_at = CASE WHEN ? = 1 THEN NULL ELSE expired_at END, updated_at = ? WHERE id = ?`,
      )
      .run(dentistId, newDate, newTime, duration, status, type, notes, planned, timeChanged ? 1 : 0, now, id);
    if (timeChanged) {
      audit(ctx, {
        action: 'appointment.reschedule', entityType: 'appointment', entityId: id,
        summary: `Rescheduled from ${existing.date} ${existing.time} to ${newDate} ${newTime}`,
        before: { date: existing.date, time: existing.time, durationMin: existing.duration_min },
        after: { date: newDate, time: newTime, durationMin: duration },
      });
    } else {
      audit(ctx, { action: 'appointment.update', entityType: 'appointment', entityId: id, summary: `Updated appointment ${newDate} ${newTime} (${status})` });
    }
  });
  return getOne(ctx, id);
}

/**
 * Manual deletion (soft). The row is hidden from every view, its reminders are
 * dismissed on the next sync, and an audit entry keeps minimal evidence. The
 * patient, visits, invoices and payments are never touched.
 */
export function deleteAppointment(ctx: Ctx, id: number): { ok: boolean } {
  requirePermission(ctx, 'appointments.manage');
  const row = ctx.db.prepare('SELECT id, date, time, status FROM appointments WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { id: number; date: string; time: string; status: string }
    | undefined;
  if (!row) throw notFound('Appointment not found.');
  tx(ctx.db, () => {
    const now = nowISO();
    ctx.db.prepare('UPDATE appointments SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    audit(ctx, {
      action: 'appointment.delete', entityType: 'appointment', entityId: id,
      summary: `Appointment ${row.date} ${row.time} deleted manually`, before: { status: row.status },
    });
  });
  return { ok: true };
}

export function cancelAppointment(ctx: Ctx, id: number, reason?: string): AppointmentDTO {
  requirePermission(ctx, 'appointments.manage');
  const existing = ctx.db.prepare('SELECT status FROM appointments WHERE id = ? AND deleted_at IS NULL').get(id) as { status: string } | undefined;
  if (!existing) throw notFound('Appointment not found.');
  if (existing.status === 'completed') throw conflict('Completed appointments cannot be cancelled.');
  // Repeating a cancel is a no-op: no duplicate note, no duplicate audit row.
  if (existing.status === 'cancelled') return getOne(ctx, id);
  const cleanReason = reason ? optString(reason, 'Cancellation reason', { max: 300 }) : null;
  tx(ctx.db, () => {
    ctx.db.prepare("UPDATE appointments SET status = 'cancelled', notes = COALESCE(notes, '') || ?, updated_at = ? WHERE id = ?")
      .run(cleanReason ? ` [Cancelled: ${cleanReason}]` : '', nowISO(), id);
    audit(ctx, { action: 'appointment.cancel', entityType: 'appointment', entityId: id, summary: 'Appointment cancelled', reason: cleanReason ?? undefined });
  });
  return getOne(ctx, id);
}

export function markNoShow(ctx: Ctx, id: number): AppointmentDTO {
  requirePermission(ctx, 'appointments.manage');
  const existing = ctx.db.prepare('SELECT status FROM appointments WHERE id = ? AND deleted_at IS NULL').get(id) as { status: string } | undefined;
  if (!existing) throw notFound('Appointment not found.');
  if (!isOpenStatus(existing.status)) {
    throw conflict(`Cannot mark a ${existing.status.replace('_', ' ')} appointment as no-show.`);
  }
  tx(ctx.db, () => {
    ctx.db.prepare("UPDATE appointments SET status = 'no_show', updated_at = ? WHERE id = ?").run(nowISO(), id);
    audit(ctx, { action: 'appointment.no_show', entityType: 'appointment', entityId: id, summary: 'Marked as no-show' });
  });
  return getOne(ctx, id);
}
