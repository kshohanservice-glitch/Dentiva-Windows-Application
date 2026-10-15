import { validation } from '../errors';

/**
 * Local-calendar ↔ stored-instant conversion for date-range filters (V5-012).
 *
 * Timestamps such as `payments.paid_at`, `visits.datetime` and `audit_log.at`
 * are stored as UTC instants (`toISOString()`), while every date the user picks
 * is a *local* calendar day (the clinic's computer time zone — Asia/Dhaka is
 * UTC+6). A local day therefore has to be converted to its UTC start and end
 * before it is compared with a stored instant; comparing against
 * `YYYY-MM-DDT00:00:00Z` shifts the day by the zone offset. The dashboard
 * already counts by local day (`date(paid_at, 'localtime')`); these helpers
 * make reports and list filters agree with it.
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDay(ymd: string, field: string): [number, number, number] {
  const m = YMD.exec(String(ymd ?? ''));
  if (!m) throw validation(`${field} must be a valid date (YYYY-MM-DD).`);
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) {
    throw validation(`${field} must be a valid calendar date.`);
  }
  return [y, mo, d];
}

/** UTC ISO instant at which local calendar day `ymd` begins. */
export function localDayStartUtc(ymd: string, field = 'Start date'): string {
  const [y, m, d] = parseLocalDay(ymd, field);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** UTC ISO instant of the last millisecond of local calendar day `ymd`. */
export function localDayEndUtc(ymd: string, field = 'End date'): string {
  const [y, m, d] = parseLocalDay(ymd, field);
  return new Date(new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime() - 1).toISOString();
}

/**
 * SQL fragment + arguments restricting `column` (a stored UTC ISO instant) to
 * the inclusive local-day range [from, to]. Open ends add no condition.
 */
export function instantRange(column: string, from?: string | null, to?: string | null): { conds: string[]; args: string[] } {
  const conds: string[] = [];
  const args: string[] = [];
  if (from) { conds.push(`${column} >= ?`); args.push(localDayStartUtc(from, 'From date')); }
  if (to) { conds.push(`${column} <= ?`); args.push(localDayEndUtc(to, 'To date')); }
  return { conds, args };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local `YYYY-MM-DD HH:MM` label for a stored UTC instant (falls back to the raw text). */
export function localDateTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '').slice(0, 16).replace('T', ' ');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local `YYYY-MM` for a stored UTC instant (falls back to the raw prefix). */
export function localMonthOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '').slice(0, 7);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
