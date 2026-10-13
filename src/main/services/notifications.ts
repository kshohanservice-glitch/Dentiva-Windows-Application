import type { DB } from '../db/database';
import type { Ctx } from '../core/context';
import type { NotificationDTO } from '../../shared/types';
import { requirePermission } from '../core/context';
import { nowISO, todayISO } from '../../shared/currency';
import { ACTIVE_APPOINTMENT_SQL } from './appointments';
import { ALL_OPEN_STATUSES, addDays, reminderKindFor } from './appointment-rules';

/** Reminder rule: one reminder per active open appointment for today and for tomorrow. */
const MAX_APPOINTMENT_REMINDERS = 200;

/**
 * Keep appointment reminders identical to the authoritative schedule.
 *  - Creates one reminder per active open appointment dated today or tomorrow.
 *  - Key = appointment id + date + time + reminder kind, so a reschedule or a
 *    day change produces a NEW key and never reuses the old reminder.
 *  - Dismisses (marks read) every unread appointment reminder whose key no
 *    longer matches: deleted, cancelled, expired, rescheduled or outdated.
 * Copy contains the patient name, time and reason only; never notes or treatments.
 */
export function syncAppointmentReminders(db: DB, today: string, enabled: boolean): number {
  const desired = new Map<string, { title: string; body: string; id: number }>();
  if (enabled) {
    const tomorrow = addDays(today, 1);
    const placeholders = ALL_OPEN_STATUSES.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT a.id, a.date, a.time, a.type, p.name patient_name, d.name dentist_name
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         LEFT JOIN dentists d ON d.id = a.dentist_id
         WHERE ${ACTIVE_APPOINTMENT_SQL} AND p.deleted_at IS NULL
           AND a.date IN (?, ?) AND a.status IN (${placeholders})
         ORDER BY a.date, a.time, a.id LIMIT ?`,
      )
      .all(today, tomorrow, ...ALL_OPEN_STATUSES, MAX_APPOINTMENT_REMINDERS) as {
        id: number; date: string; time: string; type: string; patient_name: string; dentist_name: string | null;
      }[];
    for (const r of rows) {
      const kind = reminderKindFor(r.date, today);
      if (!kind) continue;
      const key = `appt:${r.id}:${r.date}:${r.time}:${kind}`;
      const when = kind === 'today' ? 'Today' : 'Tomorrow';
      desired.set(key, {
        id: r.id,
        title: `${when} ${r.time} · ${r.patient_name}`,
        body: [r.type, r.dentist_name].filter(Boolean).join(' · '),
      });
    }
  }

  let created = 0;
  for (const [key, n] of desired) {
    if (insertNotification(db, {
      key, kind: 'appointments', severity: 'info', title: n.title, body: n.body,
      entityType: 'appointment', entityId: String(n.id),
    })) created++;
  }

  const unread = db
    .prepare("SELECT id, key FROM notifications WHERE kind = 'appointments' AND read_at IS NULL")
    .all() as { id: number; key: string }[];
  const dismiss = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?');
  const at = nowISO();
  for (const row of unread) {
    if (!desired.has(row.key)) dismiss.run(at, row.id);
  }
  return created;
}


export interface NotificationInput {
  key: string; kind: string; severity: 'info' | 'warning' | 'danger' | 'success';
  title: string; body: string; entityType?: string; entityId?: string;
}

/**
 * Insert a notification unless a row with the same key already exists.
 * Deduplication covers READ rows too: a dismissed reminder must not be
 * recreated by the next refresh (the key already embeds the day/entity).
 */
export function insertNotification(db: DB, n: NotificationInput): boolean {
  const existing = db.prepare('SELECT id FROM notifications WHERE key = ?').get(n.key);
  if (existing) return false;
  db.prepare(
    `INSERT INTO notifications (key, kind, severity, title, body, entity_type, entity_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(n.key, n.kind, n.severity, n.title, n.body, n.entityType ?? null, n.entityId ?? null, nowISO());
  return true;
}

/**
 * Refresh derived notifications from live data (deduped per day per entity).
 * Returns number of newly created rows.
 */
export function refreshNotifications(db: DB, opts: { lowStock: boolean; dues: boolean; backup: boolean; appointments: boolean }): number {
  const today = todayISO();
  let created = 0;

  if (opts.lowStock) {
    const rows = db
      .prepare(
        `SELECT i.id, i.name, i.min_level, COALESCE(SUM(b.qty_available), 0) qty
         FROM inventory_items i LEFT JOIN inventory_batches b ON b.item_id = i.id
         WHERE i.deleted_at IS NULL AND i.active = 1
         GROUP BY i.id HAVING qty <= i.min_level`,
      )
      .all() as { id: number; name: string; qty: number }[];
    for (const r of rows) {
      if (insertNotification(db, {
        key: `lowstock:${r.id}:${today}`, kind: 'inventory', severity: r.qty === 0 ? 'danger' : 'warning',
        title: r.qty === 0 ? `Out of stock: ${r.name}` : `Low stock: ${r.name}`,
        body: `${r.qty} remaining.`, entityType: 'inventory_item', entityId: String(r.id),
      })) created++;
    }
    const expiring = db
      .prepare(
        `SELECT b.id, b.expiry_date, i.name, b.qty_available FROM inventory_batches b
         JOIN inventory_items i ON i.id = b.item_id
         WHERE b.qty_available > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= date(?, '+30 days') AND i.deleted_at IS NULL`,
      )
      .all(today) as { id: number; expiry_date: string; name: string; qty_available: number }[];
    for (const r of expiring) {
      const expired = r.expiry_date < today;
      if (insertNotification(db, {
        key: `exp:${r.id}:${today}`, kind: 'inventory', severity: expired ? 'danger' : 'warning',
        title: expired ? `Expired: ${r.name}` : `Expiring soon: ${r.name}`,
        body: `${expired ? 'Expired' : 'Expires'} ${r.expiry_date} · ${r.qty_available} left.`,
        entityType: 'inventory_batch', entityId: String(r.id),
      })) created++;
    }
  }

  if (opts.backup) {
    const failed = db
      .prepare("SELECT id, filename, error FROM backups WHERE status = 'failed' AND date(created_at) = ?")
      .all(today) as { id: number; filename: string; error: string | null }[];
    for (const f of failed) {
      if (insertNotification(db, {
        key: `backupfail:${f.id}:${today}`, kind: 'backup', severity: 'danger',
        title: 'Backup failed', body: `${f.filename}: ${f.error ?? 'unknown error'}`,
        entityType: 'backup', entityId: String(f.id),
      })) created++;
    }
  }

  if (opts.dues) {
    const due = db
      .prepare(
        `SELECT COUNT(*) n FROM invoices WHERE deleted_at IS NULL AND voided_at IS NULL
           AND status IN ('unpaid','partial')`,
      )
      .get<{ n: number }>()!;
    if (Number(due.n) > 0) {
      if (insertNotification(db, {
        key: `dues:${today}`, kind: 'billing', severity: 'info',
        title: 'Outstanding dues', body: `${due.n} invoice(s) have unpaid balances.`,
      })) created++;
    }
  }

  created += syncAppointmentReminders(db, today, opts.appointments);

  return created;
}

function dto(r: any): NotificationDTO {
  return {
    id: r.id, key: r.key, kind: r.kind, severity: r.severity, title: r.title, body: r.body,
    entityType: r.entity_type, entityId: r.entity_id, createdAt: r.created_at, readAt: r.read_at,
  };
}

export function listNotifications(ctx: Ctx): NotificationDTO[] {
  const rows = ctx.db
    .prepare('SELECT * FROM notifications ORDER BY read_at IS NOT NULL, created_at DESC LIMIT 100')
    .all() as any[];
  // Hide detail-heavy bodies from users lacking the domain permission
  return rows.map((r) => {
    if (r.kind === 'billing' && !ctx.session.permissions.includes('finance.view')) {
      return { ...dto(r), body: 'You do not have permission to view financial details.' };
    }
    return dto(r);
  });
}

export function markNotificationsRead(ctx: Ctx, id?: number): { ok: true } {
  if (id != null) {
    ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(nowISO(), id);
  } else {
    ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(nowISO());
  }
  return { ok: true };
}

/** Settings-aware refresh invoked on dashboard loads (throttled by dedupe keys). */
export function refreshForContext(db: DB, settings: { notifications: { lowStock: boolean; dues: boolean; backup: boolean; appointments: boolean } }): void {
  try {
    refreshNotifications(db, {
      lowStock: settings.notifications.lowStock !== false,
      dues: settings.notifications.dues !== false,
      backup: settings.notifications.backup !== false,
      appointments: settings.notifications.appointments !== false,
    });
  } catch {
    /* notifications must never block the dashboard */
  }
}

export { requirePermission };
