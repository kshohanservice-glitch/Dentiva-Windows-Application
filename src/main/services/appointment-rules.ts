/**
 * Pure appointment rules shared by services, notifications and tests.
 *
 * Dates are calendar dates (YYYY-MM-DD) in the clinic's LOCAL time zone.
 * All arithmetic is done on calendar days with UTC-based math so that no
 * daylight-saving transition or time-zone offset can shift a date by one day.
 *
 * Lifecycle (see docs/APPOINTMENTS.md):
 *   open ──(date passes local midnight, not deleted)──▶ expired   (automatic, idempotent)
 *   open ──(staff)──▶ completed | cancelled | no_show | rescheduled-in-place
 *   any  ──(staff)──▶ deleted (soft; patient and clinical history are untouched)
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Statuses an appointment can be written with from Dentiva Pro 3.1 onward. */
export const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;
export type CurrentAppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that are still "open" (planned, not yet closed). */
export const OPEN_STATUSES = ['scheduled', 'confirmed'] as const;

/**
 * Pre-3.1 workflow statuses. They were written by the removed Queue feature and
 * are kept readable for historical rows. Open legacy rows still count as open
 * so that they expire and remain visible; they are never written again.
 */
export const LEGACY_OPEN_STATUSES = ['arrived', 'in_queue', 'in_treatment'] as const;
export const LEGACY_TERMINAL_STATUSES = ['rescheduled'] as const;

export const ALL_OPEN_STATUSES: readonly string[] = [...OPEN_STATUSES, ...LEGACY_OPEN_STATUSES];

export function isOpenStatus(status: string): boolean {
  return ALL_OPEN_STATUSES.includes(status);
}

export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Calendar-day arithmetic on YYYY-MM-DD strings (no time zone involved). */
export function addDays(isoDate: string, days: number): string {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new Error(`Invalid ISO date: ${isoDate}`);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const a = ISO_DATE.exec(from);
  const b = ISO_DATE.exec(to);
  if (!a || !b) throw new Error('Invalid ISO date');
  const ms = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) - Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return Math.round(ms / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function weekdayOf(isoDate: string): number {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new Error(`Invalid ISO date: ${isoDate}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/**
 * An open appointment dated D is active for the whole of D. At local midnight
 * that starts D+1 it is expired (if it was not deleted). Deleted appointments
 * are never reported as expired; they are simply gone from the schedule.
 */
export function isExpiredOn(appointmentDate: string, today: string): boolean {
  return appointmentDate < today;
}

/** Reminder rule: same-day and next-day reminders for active open appointments. */
export function reminderKindFor(appointmentDate: string, today: string): 'today' | 'tomorrow' | null {
  if (isExpiredOn(appointmentDate, today)) return null;
  if (appointmentDate === today) return 'today';
  if (appointmentDate === addDays(today, 1)) return 'tomorrow';
  return null;
}

export type AgendaView = 'today' | 'next7' | 'next30' | 'upcoming';

/** Inclusive date window for an agenda view. `to: null` means open-ended. */
export function agendaRange(view: AgendaView, today: string): { from: string; to: string | null } {
  switch (view) {
    case 'today':
      return { from: today, to: today };
    case 'next7':
      return { from: today, to: addDays(today, 6) };
    case 'next30':
      return { from: today, to: addDays(today, 29) };
    case 'upcoming':
    default:
      return { from: today, to: null };
  }
}

/** Time strings are HH:MM (24h). Returns minutes since midnight. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Half-open interval overlap check for two same-day appointments. */
export function overlaps(a: { time: string; durationMin: number }, b: { time: string; durationMin: number }): boolean {
  const aStart = minutesOf(a.time);
  const bStart = minutesOf(b.time);
  return aStart < bStart + b.durationMin && aStart + a.durationMin > bStart;
}
