/** Formatting helpers shared by renderer pages (BDT money, dates). */

import { formatBdt as formatBdtPaisa } from '../shared/currency';

/**
 * Display formatting for BDT paisa. Delegates to the shared integer-exact
 * formatter so screen, print and export output can never drift apart.
 */
export function bdt(paisa: number): string {
  return formatBdtPaisa(paisa);
}

/** yyyy-MM-dd for <input type="date"> */
export function isoDate(d: Date): string {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

/** Display dates in Bangladesh-friendly day/month/year order: DD/MM/YYYY. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const raw = value instanceof Date ? value : String(value);
  const match = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) : null;
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * HH:MM of a stored visit time. `visits.datetime` is the clinic's local
 * wall-clock time written in ISO form with a historical trailing `Z`, so the
 * time is read from the text itself; converting it with `new Date()` would
 * shift it by the computer's UTC offset (+6 h in Bangladesh) (V5-012).
 */
export function wallClockTime(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(String(value));
  return m ? `${m[1]}:${m[2]}` : '';
}

/**
 * 12-hour clock for patient-facing print: "14:30" → "02:30 PM". The printed
 * appointment card used to take this from the Windows language settings
 * (02:30 PM on English (US), 14:30 on English (UK)). It is now fixed to the
 * English (US) look, so the card never depends on the PC (V5-033). Returns ''
 * for anything that isn't HH:MM.
 */
export function clockTime12(value: string | null | undefined): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(String(value ?? ''));
  if (!m) return '';
  const hour = Number(m[1]);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(hour12).padStart(2, '0')}:${m[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * A date that can't be misread, for showing what a date field holds:
 * "2026-04-03" → "Fri 3 Apr 2026" and "2026-04-03T14:30" → "Fri 3 Apr 2026,
 * 14:30". On Windows, Chromium draws native date fields in the PC's own short
 * date format (mm/dd/yyyy on English (US)), while the app uses dd/mm/yyyy, so
 * forms show this under each date field (V5-033). Returns '' unless the value
 * starts with a real calendar date.
 */
export function formatDateLong(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value ?? ''));
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return '';
  const date = `${WEEKDAYS[utc.getUTCDay()]} ${day} ${MONTHS[month - 1]} ${year}`;
  return m[4] ? `${date}, ${m[4]}:${m[5]}` : date;
}

/** yyyy-MM-ddTHH:mm for <input type="datetime-local"> */
export function localDateTime(d: Date): string {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const t = new Date(dob).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (365.25 * 86_400_000)));
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const ENUM_LABELS: Record<string, string> = {
  bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay', cash: 'Cash', bank: 'Bank', card: 'Card', other: 'Other',
  no_show: 'No-show', pre_restore: 'Pre-restore', ok: 'OK',
};

/**
 * Display label for a stored enum value (status, payment method, kind):
 * `no_show` → "No-show", `bkash` → "bKash", `partial` → "Partial". Only for
 * values the application itself defines — never for patient or clinic data,
 * which is always shown exactly as entered.
 */
export function enumLabel(value: string | null | undefined): string {
  if (value == null) return '';
  const raw = String(value);
  const key = raw.trim().toLowerCase();
  if (ENUM_LABELS[key]) return ENUM_LABELS[key];
  const spaced = raw.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : raw;
}

/** Status badge tone mapping reused across lists. */
export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' {
  switch (status) {
    case 'paid':
    case 'completed':
    case 'active':
    case 'success':
      return 'success';
    case 'partial':
    case 'scheduled':
    case 'confirmed':
    case 'waiting':
    case 'called':
    case 'open':
    case 'partial ':
      return 'warning';
    case 'voided':
    case 'cancelled':
    case 'no_show':
    case 'blocked':
    case 'disabled':
    case 'locked':
    case 'expired':
      return 'danger';
    case 'unpaid':
    case 'draft':
    case 'in_queue':
    case 'in_treatment':
      return 'info';
    default:
      return 'neutral';
  }
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.slice(0, 1).toUpperCase())
    .join('');
}
