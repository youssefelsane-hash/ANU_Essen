'use server';

import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '../db';
import { addonGroups, addons, products, productVariants, roles, userRoles, users } from '../db/schema';
import { requireAuth, requirePermission } from '../auth/session';
import { can } from '../auth/authz';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password';
import { AppError } from '../errors';
import { MERCHANT_STORE_COOKIE } from '../merchant-context';
import { audit } from '../services/audit';
import { requestMeta, runAction, str } from './util';
import { parseMoney } from '../../lib/domain/misc';
import { PROTECTED_ROLE_KEYS } from '../../lib/domain/permissions';
import type { ActionState } from '../../lib/action-state';

export async function selectStoreAction(fd: FormData) {
  const id = z.uuid().parse(str(fd, 'restaurantId'));
  const auth = await requireAuth();
  if (!auth.platformPermissions.has('platform.restaurants') && !auth.storeIds.includes(id)) throw new AppError('FORBIDDEN');
  (await cookies()).set(MERCHANT_STORE_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 86400 });
  redirect('/merchant');
}

async function productScope(productId: string) {
  const [p] = await db().select().from(products).where(eq(products.id, productId));
  if (!p) throw new AppError('NOT_FOUND', 'Product not found');
  return p;
}

export async function setProductAvailability(productId: string, available: boolean) {
  const p = await productScope(productId);
  const auth = await requirePermission('menu.availability', p.restaurantId);
  await db().update(products).set({ isAvailable: available, updatedAt: new Date() }).where(eq(products.id, productId));
  await audit({
    actor: { type: 'USER', userId: auth.user.id, label: auth.user.name },
    action: 'menu.product_availability',
    entity: 'product',
    entityId: productId,
    restaurantId: p.restaurantId,
    before: { isAvailable: p.isAvailable },
    after: { isAvailable: available },
    ...(await requestMeta()),
  });
  revalidatePath('/merchant/menu');
}

export async function setVariantAvailability(variantId: string, available: boolean) {
  const [v] = await db().select().from(productVariants).where(eq(productVariants.id, variantId));
  if (!v) throw new AppError('NOT_FOUND');
  const p = await productScope(v.productId);
  const auth = await requirePermission('menu.availability', p.restaurantId);
  await db().update(productVariants).set({ isAvailable: available }).where(eq(productVariants.id, variantId));
  await audit({
    actor: { type: 'USER', userId: auth.user.id, label: auth.user.name },
    action: 'menu.variant_availability',
    entity: 'product_variant',
    entityId: variantId,
    restaurantId: p.restaurantId,
    before: { isAvailable: v.isAvailable },
    after: { isAvailable: available },
  });
  revalidatePath('/merchant/menu');
}

export async function setAddonAvailability(addonId: string, available: boolean) {
  const [a] = await db()
    .select({ addon: addons, restaurantId: addonGroups.restaurantId })
    .from(addons)
    .innerJoin(addonGroups, eq(addonGroups.id, addons.groupId))
    .where(eq(addons.id, addonId));
  if (!a) throw new AppError('NOT_FOUND');
  const auth = await requirePermission('menu.availability', a.restaurantId);
  await db().update(addons).set({ isAvailable: available }).where(eq(addons.id, addonId));
  await audit({
    actor: { type: 'USER', userId: auth.user.id, label: auth.user.name },
    action: 'menu.addon_availability',
    entity: 'addon',
    entityId: addonId,
    restaurantId: a.restaurantId,
    before: { isAvailable: a.addon.isAvailable },
    after: { isAvailable: available },
  });
  revalidatePath('/merchant/menu');
}

export async function updatePriceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const kind = str(fd, 'kind');
    const id = z.uuid().parse(str(fd, 'id'));
    const price = parseMoney(str(fd, 'price'));
    if (price === null) throw new AppError('VALIDATION', 'سعر غير صحيح');
    let productId = id;
    let before: number;
    if (kind === 'variant') {
      const [v] = await db().select().from(productVariants).where(eq(productVariants.id, id));
      if (!v) throw new AppError('NOT_FOUND');
      productId = v.productId;
      before = v.price;
    } else {
      before = (await productScope(id)).basePrice;
    }
    const p = await productScope(productId);
    const auth = await requirePermission('menu.manage', p.restaurantId);
    if (kind === 'variant') await db().update(productVariants).set({ price }).where(eq(productVariants.id, id));
    else await db().update(products).set({ basePrice: price, updatedAt: new Date() }).where(eq(products.id, id));
    await audit({
      actor: { type: 'USER', userId: auth.user.id, label: auth.user.name },
      action: 'menu.price_changed',
      entity: kind === 'variant' ? 'product_variant' : 'product',
      entityId: id,
      restaurantId: p.restaurantId,
      before: { price: before },
      after: { price },
      ...(await requestMeta()),
    });
    revalidatePath('/merchant/menu');
    return 'تم تحديث السعر';
  });
}

// ---------------------------------------------------------------- staff

export async function createStaffAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = z.uuid().parse(str(fd, 'restaurantId'));
    const auth = await requirePermission('staff.manage', restaurantId);
    const roleKey = str(fd, 'roleKey');
    const [role] = await db().select().from(roles).where(eq(roles.key, roleKey));
    if (!role || role.scope !== 'STORE') throw new AppError('VALIDATION', 'Choose a store role');
    if (PROTECTED_ROLE_KEYS.includes(role.key) && !can(auth, 'platform.users')) throw new AppError('FORBIDDEN', 'Only the platform owner can add owners');

    const email = z.email().parse(str(fd, 'email').toLowerCase());
    const name = z.string().min(2).max(80).parse(str(fd, 'name'));
    let [user] = await db().select().from(users).where(eq(users.email, email));
    if (!user) {
      const password = str(fd, 'password');
      if (password.length < MIN_PASSWORD_LENGTH) throw new AppError('VALIDATION', `كلمة السر لازم ${MIN_PASSWORD_LENGTH} حروف على الأقل`);
      [user] = await db().insert(users).values({ email, name, passwordHash: await hashPassword(password) }).returning();
    }
    await db().insert(userRoles).values({ userId: user.id, roleId: role.id, restaurantId }).onConflictDoNothing();
    await audit({
      actor: { type: 'USER', userId: auth.user.id, label: auth.user.name },
      action: 'staff.role_assigned',
      entity: 'user',
      entityId: user.id,
      restaurantId,
      after: { email, role: role.key },
      ...(await requestMeta()),
    });
    revalidatePath('/merchant/staff');
    revalidatePath('/admin/users');
    return 'تمت الإضافة';
  });
}

export async function removeStaffRoleAction(assignmentId: string) {
  const [a] = await db()
    .select({ id: userRoles.id, userId: userRoles.userId, restaurantId: userRoles.restaurantId, roleKey: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.id, assignmentId));
  if (!a || !a.restaurantId) throw new AppError('NOT_FOUND');
  const auth = await requirePermission('staff.manage', a.restaurantId);
  if (a.userId === auth.user.id) throw new AppError('FORBIDDEN', 'You cannot remove your own role');
  if (PROTECTED_ROLE_KEYS.includes(a.roleKey) && !can(auth, 'platform.users')) throw new AppError('FORBIDDEN');
  await db().delete(userRoles).where(eq(userRoles.id, assignmentId));
  await audit({
    actor: { type: 'USER', userId: auth.user.id, label: auth.user.name },
    action: 'staff.role_removed',
    entity: 'user',
    entityId: a.userId,
    restaurantId: a.restaurantId,
    before: { role: a.roleKey },
  });
  revalidatePath('/merchant/staff');
  revalidatePath('/admin/users');
}

/** A store owner may reset passwords only for users who work exclusively in their restaurant. */
export async function resetStaffPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = z.uuid().parse(str(fd, 'restaurantId'));
    const userId = z.uuid().parse(str(fd, 'userId'));
    const auth = await requirePermission('staff.manage', restaurantId);
    const elsewhere = await db()
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), isNull(userRoles.restaurantId)))
      .union(db().select({ id: userRoles.id }).from(userRoles).where(and(eq(userRoles.userId, userId), ne(userRoles.restaurantId, restaurantId))));
    if (elsewhere.length && !can(auth, 'platform.users')) throw new AppError('FORBIDDEN', 'This user also works elsewhere — ask the platform admin');
    const here = await db().select({ id: userRoles.id }).from(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.restaurantId, [restaurantId])));
    if (!here.length) throw new AppError('NOT_FOUND');
    const password = str(fd, 'password');
    if (password.length < MIN_PASSWORD_LENGTH) throw new AppError('VALIDATION', `كلمة السر لازم ${MIN_PASSWORD_LENGTH} حروف على الأقل`);
    await db().update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, userId));
    await audit({ actor: { type: 'USER', userId: auth.user.id, label: auth.user.name }, action: 'staff.password_reset', entity: 'user', entityId: userId, restaurantId });
    return 'تم تغيير كلمة السر';
  });
}
