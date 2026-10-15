import type { Ctx } from '../core/context';
import type { AuditEntry, Paged } from '../../shared/types';
import type { PermissionKey } from '../../shared/permissions';
import type { RoleDTO, UserDTO } from '../../shared/types';
import { conflict, forbidden, notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { hashPassword } from '../core/passwords';
import { loadPermissions } from './auth';
import { nowISO } from '../../shared/currency';
import { optString, pageParams, reqPassword, reqString, reqUsername, oneOf, escapeLike } from '../core/validate';
import { instantRange } from '../core/dates';
import { isPermissionKey, BUILTIN_ROLES } from '../../shared/permissions';

function minPasswordLengthOf(ctx: Ctx): number {
  try {
    const row = ctx.db.prepare("SELECT value_json FROM settings WHERE key = 'security'").get<{ value_json: string }>();
    const parsed = row ? JSON.parse(row.value_json) : {};
    const n = Number(parsed?.minPasswordLength);
    return Number.isFinite(n) ? Math.min(64, Math.max(8, Math.round(n))) : 8;
  } catch {
    return 8;
  }
}

/* ------------------------------- Users -------------------------------- */

function userDTO(r: any, permissions?: PermissionKey[], hasPermissionOverrides?: boolean): UserDTO {
  return {
    id: r.id, username: r.username, displayName: r.display_name,
    roleId: r.role_id, roleName: r.role_name, status: r.status,
    staffId: r.staff_id, lastLoginAt: r.last_login_at, createdAt: r.created_at,
    mustChangePassword: !!r.must_change_password, permissions, hasPermissionOverrides,
  };
}

const SELECT_USER = `
  SELECT u.*, r.name role_name FROM users u JOIN roles r ON r.id = u.role_id
  WHERE u.deleted_at IS NULL ORDER BY u.username`;

function hasOverrides(ctx: Ctx, userId: number): boolean {
  return !!ctx.db.prepare('SELECT 1 FROM user_permission_overrides WHERE user_id = ? LIMIT 1').get(userId);
}

function rolePermissions(ctx: Ctx, roleId: number): Set<PermissionKey> {
  return new Set(
    ctx.db.prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
      .all<{ permission_key: string }>(roleId)
      .map((r) => r.permission_key as PermissionKey),
  );
}

function isOwner(ctx: Ctx): boolean {
  return ctx.session.roleKey === 'owner';
}

/**
 * Privilege ceiling (V5-016): a non-owner may hand out only permissions that
 * they hold themselves, so `users.manage` / `roles.manage` can never be used to
 * escalate beyond the actor's own access. The Owner is the root of trust.
 */
function assertWithinActorPermissions(ctx: Ctx, perms: Iterable<PermissionKey>, what: string): void {
  if (isOwner(ctx)) return;
  const own = new Set(ctx.session.permissions);
  const beyond = [...new Set(perms)].filter((p) => !own.has(p));
  if (beyond.length > 0) {
    throw forbidden(`You cannot ${what} with permissions you do not have yourself: ${beyond.join(', ')}.`);
  }
}

/** Active owner accounts other than `excludeUserId`. */
function otherActiveOwners(ctx: Ctx, excludeUserId: number): number {
  return Number(ctx.db.prepare(
    `SELECT COUNT(*) c FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.key = 'owner' AND u.status = 'active' AND u.deleted_at IS NULL AND u.id != ?`,
  ).get<{ c: number }>(excludeUserId)!.c);
}

export async function listUsers(ctx: Ctx): Promise<UserDTO[]> {
  requirePermission(ctx, 'users.manage');
  const rows = ctx.db.prepare(SELECT_USER).all() as any[];
  return rows.map((r) => userDTO(r, loadPermissions(ctx.db, r.id, r.role_id), hasOverrides(ctx, r.id)));
}

export interface UserSaveInput {
  id?: number; username: string; displayName: string; password?: string;
  roleId: number; status?: string; staffId?: number | null; permissions?: PermissionKey[] | null;
}

/**
 * Resolve the requested override into the stored grant/revoke rows.
 * `undefined` keeps the stored overrides, `null` clears them, and an array is
 * the user's exact effective permission set (V5-014).
 */
function resolveOverrides(
  requested: PermissionKey[] | null | undefined,
  rolePerms: Set<PermissionKey>,
): { grants: PermissionKey[]; revokes: PermissionKey[] } | 'keep' {
  if (requested === undefined) return 'keep';
  if (requested === null) return { grants: [], revokes: [] };
  if (!Array.isArray(requested)) throw validation('Permissions must be a list.');
  for (const p of requested) {
    if (typeof p !== 'string' || !isPermissionKey(p)) throw validation(`Unknown permission "${String(p)}".`);
  }
  const desired = new Set(requested);
  return {
    grants: [...desired].filter((p) => !rolePerms.has(p)).sort(),
    revokes: [...rolePerms].filter((p) => !desired.has(p)).sort(),
  };
}

function currentOverrides(ctx: Ctx, userId: number): { grants: PermissionKey[]; revokes: PermissionKey[] } {
  const rows = ctx.db.prepare('SELECT permission_key, is_grant FROM user_permission_overrides WHERE user_id = ?')
    .all<{ permission_key: string; is_grant: number }>(userId);
  return {
    grants: rows.filter((r) => r.is_grant).map((r) => r.permission_key as PermissionKey).sort(),
    revokes: rows.filter((r) => !r.is_grant).map((r) => r.permission_key as PermissionKey).sort(),
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function saveUser(ctx: Ctx, input: UserSaveInput): Promise<UserDTO> {
  requirePermission(ctx, 'users.manage');
  const username = reqUsername(input?.username);
  const displayName = reqString(input?.displayName, 'Display name', { max: 120 });
  const roleId = reqIntSafe(input?.roleId);
  const status = oneOf(input?.status ?? 'active', ['active', 'locked', 'disabled'] as const, 'Status');
  const role = ctx.db.prepare('SELECT id, key FROM roles WHERE id = ?').get(roleId) as { key: string } | undefined;
  if (!role) throw validation('Select a valid role.');
  const staffId = input?.staffId === undefined || input?.staffId === null || (input.staffId as unknown) === ''
    ? null
    : reqIntSafeField(input.staffId, 'Staff record');
  if (staffId !== null && !ctx.db.prepare('SELECT 1 FROM staff WHERE id = ?').get(staffId)) {
    throw validation('Select a valid staff record.');
  }

  // Owner-account protection: only an actor whose own role is "owner" may
  // assign the owner role or modify a user that holds it. Prevents a
  // same-privilege administrator from demoting/disabling the clinic owner.
  const isOwnerActor = isOwner(ctx);
  const targetIsOwner = input.id
    ? (() => {
        const t = ctx.db
          .prepare('SELECT r.key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.deleted_at IS NULL')
          .get(input.id) as { key: string } | undefined;
        return t?.key === 'owner';
      })()
    : false;
  if (!isOwnerActor && (role.key === 'owner' || targetIsOwner)) {
    throw forbidden('Only the Owner can assign or modify Owner accounts.');
  }

  const rolePerms = rolePermissions(ctx, roleId);
  const requested = resolveOverrides(input.permissions, rolePerms);
  const minPwLen = minPasswordLengthOf(ctx);

  if (input.id) {
    const existing = ctx.db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(input.id) as any;
    if (!existing) throw notFound('User not found.');
    const dup = ctx.db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, input.id);
    if (dup) throw conflict(`Username "${username}" is already taken.`);

    const stored = currentOverrides(ctx, input.id);
    const overridesChange = requested !== 'keep'
      && (!sameList(requested.grants, stored.grants) || !sameList(requested.revokes, stored.revokes));
    const roleChange = Number(existing.role_id) !== roleId;
    const statusChange = existing.status !== status;

    // Self-service guard (V5-016): nobody changes their own role, status or
    // permissions — that is how accounts escalate or lock the clinic out.
    if (input.id === ctx.session.userId && (roleChange || statusChange || overridesChange)) {
      throw forbidden('You cannot change your own role, status or permissions. Ask another administrator or the Owner.');
    }
    // A non-owner cannot manage an account that holds more access than they do.
    if (!isOwnerActor) {
      assertWithinActorPermissions(ctx, loadPermissions(ctx.db, input.id, Number(existing.role_id)), 'modify a user');
    }
    if (overridesChange && !ctx.session.permissions.includes('roles.manage')) {
      throw forbidden('Changing per-user permissions requires the "roles.manage" permission.');
    }
    const finalOverrides = requested === 'keep' ? stored : requested;
    const effective = [...new Set([...[...rolePerms].filter((p) => !finalOverrides.revokes.includes(p)), ...finalOverrides.grants])];
    if (roleChange || overridesChange) {
      assertWithinActorPermissions(ctx, effective, 'give a user access');
    }
    // At least one active Owner must always remain (V5-016).
    const staysActiveOwner = role.key === 'owner' && status === 'active';
    if (targetIsOwner && existing.status === 'active' && !staysActiveOwner && otherActiveOwners(ctx, input.id) === 0) {
      throw conflict('At least one active Owner account must remain. Make another user an Owner first.');
    }

    const newHash = input.password ? await hashPassword(reqPassword(input.password, minPwLen)) : null;

    tx(ctx.db, () => {
      ctx.db
        .prepare('UPDATE users SET username = ?, display_name = ?, role_id = ?, status = ?, staff_id = ?, updated_at = ? WHERE id = ?')
        .run(username, displayName, roleId, status, staffId, nowISO(), input.id);
      if (newHash) {
        ctx.db
          .prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?')
          .run(newHash, input.id);
      }
      if (requested !== 'keep' && overridesChange) {
        ctx.db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(input.id);
        const ins = ctx.db.prepare('INSERT INTO user_permission_overrides (user_id, permission_key, is_grant) VALUES (?, ?, ?)');
        for (const p of requested.grants) ins.run(input.id, p, 1);
        for (const p of requested.revokes) ins.run(input.id, p, 0);
      }
      audit(ctx, {
        action: 'user.update', entityType: 'user', entityId: input.id,
        summary: `Updated user ${username}`,
        before: { status: existing.status, roleId: existing.role_id, overrides: stored },
        after: { status, roleId, overrides: finalOverrides },
      });
    });
    const row = ctx.db.prepare(SELECT_USER.replace('WHERE u.deleted_at IS NULL ORDER BY u.username', 'WHERE u.id = ?')).get(input.id) as any;
    return userDTO(row, loadPermissions(ctx.db, input.id, roleId), hasOverrides(ctx, input.id));
  }

  if (!input.password) throw validation('Password is required for a new user.');
  const newOverrides = requested === 'keep' ? { grants: [], revokes: [] } : requested;
  if ((newOverrides.grants.length || newOverrides.revokes.length) && !ctx.session.permissions.includes('roles.manage')) {
    throw forbidden('Changing per-user permissions requires the "roles.manage" permission.');
  }
  const effective = [...new Set([...[...rolePerms].filter((p) => !newOverrides.revokes.includes(p)), ...newOverrides.grants])];
  assertWithinActorPermissions(ctx, effective, 'create a user');
  const passwordHash = await hashPassword(reqPassword(input.password, minPwLen));

  const id = tx(ctx.db, () => {
    try {
      const info = ctx.db
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, role_id, staff_id, status, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(username, displayName, passwordHash, roleId, staffId, status, nowISO(), nowISO());
      const userId = Number(info.lastInsertRowid);
      const ins = ctx.db.prepare('INSERT INTO user_permission_overrides (user_id, permission_key, is_grant) VALUES (?, ?, ?)');
      for (const p of newOverrides.grants) ins.run(userId, p, 1);
      for (const p of newOverrides.revokes) ins.run(userId, p, 0);
      audit(ctx, { action: 'user.create', entityType: 'user', entityId: userId, summary: `Created user ${username} (${input.roleId})`, after: { roleId, overrides: newOverrides } });
      return userId;
    } catch (e: any) {
      if (String(e?.message ?? '').includes('UNIQUE')) throw conflict(`Username "${username}" is already taken.`);
      throw e;
    }
  });
  const row = ctx.db.prepare(SELECT_USER.replace('WHERE u.deleted_at IS NULL ORDER BY u.username', 'WHERE u.id = ?')).get(id) as any;
  return userDTO(row, loadPermissions(ctx.db, id, roleId), hasOverrides(ctx, id));
}

/**
 * Delete (soft) a user account. Requires both user management and the
 * destructive-data permission; only an Owner may delete an Owner account, and
 * the last active Owner can never be deleted (V5-015).
 */
export function deleteUser(ctx: Ctx, id: number): { ok: boolean } {
  requirePermission(ctx, 'users.manage');
  requirePermission(ctx, 'data.delete');
  const row = ctx.db.prepare(
    `SELECT u.id, u.username, u.display_name, u.status, u.role_id, r.key role_key FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ? AND u.deleted_at IS NULL`,
  ).get(id) as { id: number; username: string; display_name: string; status: string; role_id: number; role_key: string } | undefined;
  if (!row) throw notFound('User not found.');
  if (row.id === ctx.session.userId) throw conflict('You cannot delete your own signed-in account.');
  if (row.role_key === 'owner') {
    if (!isOwner(ctx)) throw forbidden('Only the Owner can delete an Owner account.');
    if (row.status === 'active' && otherActiveOwners(ctx, row.id) === 0) {
      throw conflict('At least one active Owner account must remain.');
    }
  }
  if (!isOwner(ctx)) {
    assertWithinActorPermissions(ctx, loadPermissions(ctx.db, row.id, row.role_id), 'delete a user');
  }
  const at = new Date().toISOString();
  tx(ctx.db, () => {
    ctx.db.prepare("UPDATE users SET deleted_at = ?, status = 'disabled', updated_at = ? WHERE id = ?").run(at, at, id);
    audit(ctx, { action: 'user.delete', entityType: 'user', entityId: id, summary: `Deleted user ${row.username}` });
  });
  return { ok: true };
}

export async function resetPassword(ctx: Ctx, userId: number, newPassword: string): Promise<{ ok: boolean }> {
  requirePermission(ctx, 'users.manage');
  const row = ctx.db
    .prepare('SELECT u.id, u.role_id, r.key role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.deleted_at IS NULL')
    .get(userId) as { id: number; role_id: number; role_key: string } | undefined;
  if (!row) throw notFound('User not found.');
  if (row.role_key === 'owner' && ctx.session.roleKey !== 'owner') {
    audit(ctx, {
      action: 'user.reset_password',
      entityType: 'user',
      entityId: userId,
      summary: 'Denied reset of owner password by non-owner',
      result: 'denied',
      reason: 'Only the Owner can reset an Owner account password.',
    });
    throw forbidden('Only the Owner can assign or modify Owner accounts.');
  }
  if (!isOwner(ctx)) {
    assertWithinActorPermissions(ctx, loadPermissions(ctx.db, row.id, row.role_id), 'reset the password of a user');
  }
  const hash = await hashPassword(reqPassword(newPassword, minPasswordLengthOf(ctx)));
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
      .run(hash, nowISO(), userId);
    audit(ctx, { action: 'user.reset_password', entityType: 'user', entityId: userId, summary: 'Password reset by administrator' });
  });
  return { ok: true };
}

function reqIntSafeField(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw validation(`${field} is not valid.`);
  return n;
}

function reqIntSafe(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw validation('Select a valid role.');
  return n;
}

/* -------------------------------- Roles -------------------------------- */

function roleDTO(ctx: Ctx, r: any): RoleDTO {
  const permissions = ctx.db
    .prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
    .all<{ permission_key: string }>(r.id)
    .map((x) => x.permission_key) as PermissionKey[];
  const userCount = Number(ctx.db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ? AND deleted_at IS NULL').get<{ c: number }>(r.id)!.c);
  return { id: r.id, key: r.key, name: r.name, description: r.description, builtin: !!r.builtin, permissions, userCount };
}

export function listRoles(ctx: Ctx): RoleDTO[] {
  requirePermission(ctx, 'users.manage');
  const rows = ctx.db.prepare('SELECT * FROM roles ORDER BY builtin DESC, name').all() as any[];
  return rows.map((r) => roleDTO(ctx, r));
}

export function saveRole(ctx: Ctx, input: { id?: number; key?: string; name: string; description?: string; permissions: PermissionKey[] }): RoleDTO {
  requirePermission(ctx, 'roles.manage');
  const name = reqString(input?.name, 'Role name', { max: 60 });
  const perms = Array.isArray(input?.permissions) ? input.permissions : [];
  for (const p of perms) {
    if (!isPermissionKey(p)) throw validation(`Unknown permission "${p}".`);
  }
  // Privilege ceiling (V5-016): a role can only carry permissions the actor holds.
  assertWithinActorPermissions(ctx, perms, 'save a role');

  if (input.id) {
    const existing = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(input.id) as any;
    if (!existing) throw notFound('Role not found.');
    if (existing.builtin) {
      const allowed = new Set(BUILTIN_ROLES[existing.key]?.permissions ?? []);
      for (const p of perms) if (!allowed.has(p)) throw validation(`Built-in role "${existing.name}" cannot be granted "${p}".`);
      if (perms.length === 0) throw validation('Built-in roles must keep at least their standard permissions.');
    }
    tx(ctx.db, () => {
      ctx.db.prepare('UPDATE roles SET name = ?, description = ? WHERE id = ?')
        .run(name, optString(input.description, 'Description', { max: 400 }), input.id);
      if (existing.builtin) {
        // Built-ins: only allow tightening? Keep grants as designed — restore standard set.
        const std = BUILTIN_ROLES[existing.key]?.permissions ?? perms;
        ctx.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(input.id);
        const ins = ctx.db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
        for (const p of std) ins.run(input.id, p);
      } else {
        ctx.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(input.id);
        const ins = ctx.db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
        for (const p of perms) ins.run(input.id, p);
      }
      audit(ctx, { action: 'role.update', entityType: 'role', entityId: input.id, summary: `Updated role ${name}`, after: { permissions: perms.length } });
    });
    const row = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(input.id) as any;
    return roleDTO(ctx, row);
  }

  const key = reqString(input.key ?? name.toLowerCase().replace(/\W+/g, '_'), 'Role key', { max: 60 }).toLowerCase();
  const dup = ctx.db.prepare('SELECT id FROM roles WHERE key = ? OR name = ?').get(key, name);
  if (dup) throw conflict(`A role named "${name}" already exists.`);
  const id = tx(ctx.db, () => {
    const info = ctx.db.prepare('INSERT INTO roles (key, name, description, builtin, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(key, name, optString(input.description, 'Description', { max: 400 }), nowISO());
    const roleId = Number(info.lastInsertRowid);
    const ins = ctx.db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const p of perms) ins.run(roleId, p);
    audit(ctx, { action: 'role.create', entityType: 'role', entityId: roleId, summary: `Created role ${name}`, after: { permissions: perms } });
    return roleId;
  });
  const row = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
  return roleDTO(ctx, row);
}

export function removeRole(ctx: Ctx, id: number): { ok: boolean } {
  requirePermission(ctx, 'roles.manage');
  const existing = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
  if (!existing) throw notFound('Role not found.');
  if (existing.builtin) throw conflict('Built-in roles cannot be deleted.');
  const users = Number(ctx.db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ? AND deleted_at IS NULL').get<{ c: number }>(id)!.c);
  if (users > 0) throw conflict(`Role is in use by ${users} user(s). Reassign them first.`);
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    audit(ctx, { action: 'role.delete', entityType: 'role', entityId: id, summary: `Deleted role ${existing.name}` });
  });
  return { ok: true };
}

/* -------------------------------- Audit -------------------------------- */

export function listAudit(ctx: Ctx, filter: { page?: number; pageSize?: number; action?: string; userId?: number; from?: string; to?: string; query?: string } = {}): Paged<AuditEntry> {
  requirePermission(ctx, 'audit.view');
  const { page, pageSize, offset } = pageParams(filter.page, filter.pageSize);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.action) {
    if (filter.action === 'billing.') {
      where.push("(action LIKE 'billing.%' OR action LIKE 'invoice.%')");
    } else if (filter.action.endsWith('.')) {
      where.push("action LIKE ? ESCAPE '\\'");
      params.push(`${escapeLike(filter.action)}%`);
    } else {
      where.push('action = ?');
      params.push(filter.action);
    }
  }
  if (filter.userId) { where.push('user_id = ?'); params.push(filter.userId); }
  // audit_log.at is a UTC instant; the filter dates are the clinic's local days
  // (same bounds as the audit report — V5-012).
  const range = instantRange('at', filter.from, filter.to);
  where.push(...range.conds);
  params.push(...range.args);
  if (filter.query?.trim()) {
    const q = `%${escapeLike(filter.query.trim().toLowerCase())}%`;
    where.push("(LOWER(summary) LIKE ? ESCAPE '\\' OR LOWER(username) LIKE ? ESCAPE '\\' OR LOWER(action) LIKE ? ESCAPE '\\')");
    params.push(q, q, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(ctx.db.prepare(`SELECT COUNT(*) c FROM audit_log ${whereSql}`).get(...params as any[])!['c']);
  const rows = ctx.db
    .prepare(`SELECT id, at, user_id, username, action, entity_type, entity_id, summary, result, reason FROM audit_log ${whereSql} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params as any[], pageSize, offset) as any[];
  return {
    items: rows.map((r) => ({
      id: r.id, at: r.at, userId: r.user_id, username: r.username, action: r.action,
      entityType: r.entity_type, entityId: r.entity_id, summary: r.summary,
      result: r.result, reason: r.reason,
    })),
    total, page, pageSize,
  };
}
