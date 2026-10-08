'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, isUniqueViolation, type Db } from '../db';
import { permissions, rolePermissions, roles, sessions, settlements, systemSettings, userRoles, users } from '../db/schema';
import { requirePermission } from '../auth/session';
import type { AuthContext } from '../auth/authz';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password';
import { AppError } from '../errors';
import { audit } from '../services/audit';
import { removeCourierAssignment } from '../services/couriers';
import { optStr, requestMeta, runAction, str } from './util';
import type { ActionState } from '../../lib/action-state';
import { parseMoney } from '../../lib/domain/misc';
import { platformProfileSchema } from '../../lib/domain/platform-profile';
import { getPlatformProfile, PLATFORM_PROFILE_KEY } from '../platform-profile';

const actor = (auth: AuthContext) => ({ type: 'USER' as const, userId: auth.user.id, label: auth.user.name });

// ---------------------------------------------------------------- finance

export async function recordSettlementAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requirePermission('platform.finance');
    const restaurantId = z.uuid().parse(str(fd, 'restaurantId'));
    const amountPaid = parseMoney(str(fd, 'amount'));
    if (!amountPaid) throw new AppError('VALIDATION', 'Enter the amount received');
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const periodStart = optStr(fd, 'periodStart');
    const periodEnd = optStr(fd, 'periodEnd');
    if ((periodStart && !dateRe.test(periodStart)) || (periodEnd && !dateRe.test(periodEnd))) throw new AppError('VALIDATION', 'Invalid period');
    const values = { restaurantId, amountPaid, periodStart, periodEnd, note: optStr(fd, 'note'), recordedByUserId: auth.user.id };
    const [row] = await db().insert(settlements).values(values).returning();
    await audit({ actor: actor(auth), action: 'settlement.recorded', entity: 'settlement', entityId: row.id, restaurantId, after: values, ...(await requestMeta()) });
    revalidatePath('/admin/finance');
    return 'Settlement recorded';
  });
}

// ---------------------------------------------------------------- users & roles

async function roleByKey(key: string, executor: Db = db()) {
  const [r] = await executor.select().from(roles).where(eq(roles.key, key));
  if (!r) throw new AppError('VALIDATION', 'Unknown role');
  return r;
}

async function assign(userId: string, roleKey: string, restaurantIdRaw: string | null, executor: Db = db()) {
  const role = await roleByKey(roleKey, executor);
  const restaurantId = role.scope === 'STORE' ? z.uuid().parse(restaurantIdRaw ?? '') : null;
  await executor.insert(userRoles).values({ userId, roleId: role.id, restaurantId }).onConflictDoNothing();
  return { role: role.key, restaurantId };
}

export async function createUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requirePermission('platform.users');
    const email = z.email().parse(str(fd, 'email').toLowerCase());
    const name = z.string().min(2).max(80).parse(str(fd, 'name'));
    const password = str(fd, 'password');
    if (password.length < MIN_PASSWORD_LENGTH) throw new AppError('VALIDATION', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    const [exists] = await db().select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) throw new AppError('CONFLICT', 'A user with this email already exists');
    const passwordHash = await hashPassword(password);
    const roleKey = str(fd, 'roleKey');
    let result;
    try {
      result = await db().transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ email, name, phone: optStr(fd, 'phone'), passwordHash }).returning();
        const assigned = roleKey ? await assign(user.id, roleKey, optStr(fd, 'restaurantId'), tx) : null;
        return { user, assigned };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('CONFLICT', 'A user with this email already exists');
      throw error;
    }
    const { user, assigned } = result;
    await audit({ actor: actor(auth), action: 'user.created', entity: 'user', entityId: user.id, restaurantId: assigned?.restaurantId ?? null, after: { email, name, ...assigned }, ...(await requestMeta()) });
    revalidatePath('/admin/users');
    return 'User created';
  });
}

export async function assignRoleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requirePermission('platform.users');
    const userId = z.uuid().parse(str(fd, 'userId'));
    const assigned = await assign(userId, str(fd, 'roleKey'), optStr(fd, 'restaurantId'));
    await audit({ actor: actor(auth), action: 'user.role_assigned', entity: 'user', entityId: userId, restaurantId: assigned.restaurantId, after: assigned, ...(await requestMeta()) });
    revalidatePath(`/admin/users/${userId}`);
    return 'Role assigned';
  });
}

export async function removeRoleAction(assignmentId: string) {
  const auth = await requirePermission('platform.users');
  const [a] = await db()
    .select({ userId: userRoles.userId, restaurantId: userRoles.restaurantId, key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.id, assignmentId));
  if (!a) throw new AppError('NOT_FOUND');
  if (a.userId === auth.user.id && a.key === 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'You cannot remove your own super admin role');
  if (a.key === 'DELIVERY_STAFF') {
    await removeCourierAssignment({ assignmentId, origin: 'PLATFORM', actor: { auth, ...(await requestMeta()) } });
    revalidatePath(`/admin/users/${a.userId}`);
    revalidatePath('/admin/delivery');
    revalidatePath('/merchant/staff');
    return;
  }
  await db().delete(userRoles).where(eq(userRoles.id, assignmentId));
  await audit({ actor: actor(auth), action: 'user.role_removed', entity: 'user', entityId: a.userId, restaurantId: a.restaurantId, before: { role: a.key } });
  revalidatePath(`/admin/users/${a.userId}`);
}

export async function setUserActiveAction(userId: string, active: boolean) {
  const auth = await requirePermission('platform.users');
  if (userId === auth.user.id && !active) throw new AppError('FORBIDDEN', 'You cannot disable yourself');
  await db().update(users).set({ isActive: active, updatedAt: new Date() }).where(eq(users.id, userId));
  if (!active) await db().delete(sessions).where(eq(sessions.userId, userId)); // sign out everywhere
  await audit({ actor: actor(auth), action: active ? 'user.enabled' : 'user.disabled', entity: 'user', entityId: userId });
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/admin/users');
}

export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requirePermission('platform.users');
    const userId = z.uuid().parse(str(fd, 'userId'));
    const password = str(fd, 'password');
    if (password.length < MIN_PASSWORD_LENGTH) throw new AppError('VALIDATION', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    await db().update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, userId));
    await db().delete(sessions).where(eq(sessions.userId, userId));
    await audit({ actor: actor(auth), action: 'user.password_reset', entity: 'user', entityId: userId, ...(await requestMeta()) });
    return 'Password changed (all sessions signed out)';
  });
}

export async function saveRoleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requirePermission('platform.users');
    const id = str(fd, 'id');
    const allPerms = await db().select().from(permissions);
    const granted = fd.getAll('permissions').map(String);
    let role: typeof roles.$inferSelect;
    if (id) {
      [role] = await db().select().from(roles).where(eq(roles.id, z.uuid().parse(id)));
      if (!role) throw new AppError('NOT_FOUND');
      if (role.key === 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'SUPER_ADMIN always has every permission');
    } else {
      const key = z.string().regex(/^[A-Z][A-Z0-9_]{2,40}$/, 'Key: UPPER_CASE letters').parse(str(fd, 'key'));
      const scope = z.enum(['PLATFORM', 'STORE']).parse(str(fd, 'scope'));
      [role] = await db().insert(roles).values({ key, name: z.string().min(2).parse(str(fd, 'name')), scope, description: optStr(fd, 'description') }).returning();
    }
    // A store role can never hold platform permissions.
    const valid = granted.filter((g) => allPerms.some((p) => p.key === g && (role.scope === 'PLATFORM' || p.scope === 'STORE')));
    const before = (await db().select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id))).map((r) => r.permissionKey);
    await db().transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      if (valid.length) await tx.insert(rolePermissions).values(valid.map((p) => ({ roleId: role.id, permissionKey: p })));
    });
    await audit({ actor: actor(auth), action: id ? 'role.permissions_changed' : 'role.created', entity: 'role', entityId: role.id, before: { permissions: before }, after: { key: role.key, permissions: valid }, ...(await requestMeta()) });
    revalidatePath('/admin/roles');
    return 'Role saved';
  });
}

// ---------------------------------------------------------------- system settings

export async function saveSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requirePermission('platform.settings');
    const pct = Number(str(fd, 'defaultCommissionPercent'));
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new AppError('VALIDATION', 'Commission must be 0–50%');
    const tz = str(fd, 'timezone') || 'Africa/Cairo';
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      throw new AppError('VALIDATION', 'Unknown timezone');
    }
    const entries: [string, unknown][] = [
      ['platform.name', z.string().min(2).max(60).parse(str(fd, 'platformName'))],
      ['platform.timezone', tz],
      ['defaults.commissionBps', Math.round(pct * 100)],
    ];
    const before = await db().select().from(systemSettings);
    for (const [key, value] of entries) {
      await db()
        .insert(systemSettings)
        .values({ key, value, updatedByUserId: auth.user.id })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date(), updatedByUserId: auth.user.id } });
    }
    await audit({
      actor: actor(auth),
      action: 'settings.updated',
      entity: 'system_settings',
      before: Object.fromEntries(before.filter((b) => entries.some(([k]) => k === b.key)).map((b) => [b.key, b.value])),
      after: Object.fromEntries(entries),
      ...(await requestMeta()),
    });
    revalidatePath('/admin/settings');
    return 'Settings saved';
  });
}

const PROFILE_FIELD_AR: Record<string, string> = {
  nameAr: 'اسم المنصة بالعربي', nameEn: 'اسم المنصة بالإنجليزي', descriptionAr: 'الوصف بالعربي', descriptionEn: 'الوصف بالإنجليزي',
  companyAr: 'اسم الشركة بالعربي', companyEn: 'اسم الشركة بالإنجليزي', whatsapp: 'رقم واتساب', email: 'البريد الإلكتروني',
  facebookUrl: 'فيسبوك (يبدأ بـ https://)', instagramUrl: 'إنستجرام (يبدأ بـ https://)', tiktokUrl: 'تيك توك (يبدأ بـ https://)',
  addressAr: 'العنوان', commercialRegister: 'السجل التجاري', taxId: 'الرقم الضريبي', orderAheadAr: 'جملة الطلب المسبق بالعربي', orderAheadEn: 'جملة الطلب المسبق بالإنجليزي',
};

/** Public platform identity: footer, legal pages, contact links and the "order ahead" line. */
export async function savePlatformProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requirePermission('platform.settings');
    const fields = Object.keys(platformProfileSchema.shape) as (keyof typeof platformProfileSchema.shape)[];
    const parsed = platformProfileSchema.safeParse(Object.fromEntries(fields.map((k) => [k, str(fd, k)])));
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? '');
      throw new AppError('VALIDATION', `راجع خانة «${PROFILE_FIELD_AR[field] ?? field}»`);
    }
    const before = await getPlatformProfile();
    await db()
      .insert(systemSettings)
      .values({ key: PLATFORM_PROFILE_KEY, value: parsed.data, updatedByUserId: auth.user.id })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: parsed.data, updatedAt: new Date(), updatedByUserId: auth.user.id } });
    await audit({ actor: actor(auth), action: 'settings.platform_profile', entity: 'system_settings', entityId: null, before, after: parsed.data, ...(await requestMeta()) });
    revalidatePath('/', 'layout');
    return 'Settings saved';
  });
}
