'use server';

import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db, isUniqueViolation } from '../db';
import {
  addonGroups,
  addons,
  banners,
  categories,
  deliveryPoints,
  productAddonGroups,
  products,
  productVariants,
  promotions,
  queueConfigs,
  restaurantPaymentMethods,
  restaurants,
  systemSettings,
} from '../db/schema';
import { requirePermission } from '../auth/session';
import { can, type AuthContext } from '../auth/authz';
import { AppError } from '../errors';
import { audit, diff } from '../services/audit';
import { getDefaultQueueConfig, getQueueConfig } from '../services/store';
import { bootstrapRestaurant } from '../seed';
import { bool, int, json, optStr, requestMeta, runAction, str } from './util';
import type { ActionState } from '../../lib/action-state';
import { fromZonedInputValue, weeklyHoursSchema } from '../../lib/domain/hours';
import { parseMoney, slugify } from '../../lib/domain/misc';
import { PROMOTION_TYPES } from '../../lib/domain/pricing';
import { FULFILLMENT_TYPES } from '../../lib/domain/order-machine';
import { queueConfigSchema } from '../../lib/domain/queue';
import { restaurantBrandSchema, restaurantImageUrlSchema } from '../../lib/domain/restaurant-brand';

const actor = (auth: AuthContext) => ({ type: 'USER' as const, userId: auth.user.id, label: auth.user.name });
const uuid = (v: string) => z.uuid().parse(v);
const webUrl = z.url().refine((value) => {
  const url = new URL(value);
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
}, 'Use an http(s) payment link without embedded credentials');
const money = (fd: FormData, key: string, required = true) => {
  const v = parseMoney(str(fd, key));
  if (v === null && required) throw new AppError('VALIDATION', `${key}: invalid amount`);
  return v;
};
/** datetime-local inputs are wall-clock times in the restaurant's timezone (servers run in UTC). */
const dateOrNull = (fd: FormData, key: string, timeZone: string) => {
  const v = str(fd, key);
  if (!v) return null;
  const d = fromZonedInputValue(v, timeZone);
  if (!d) throw new AppError('VALIDATION', `${key}: invalid date`);
  return d;
};

async function restaurantOrThrow(id: string) {
  const [r] = await db().select().from(restaurants).where(eq(restaurants.id, id));
  if (!r) throw new AppError('NOT_FOUND', 'Restaurant not found');
  return r;
}

// ---------------------------------------------------------------- restaurants

export async function createRestaurantAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = '';
  const res = await runAction(async () => {
    const auth = await requirePermission('platform.restaurants');
    const brand = restaurantBrandSchema.parse({ nameAr: str(fd, 'nameAr'), nameEn: str(fd, 'nameEn'), badgeText: optStr(fd, 'badgeText'), badgeTextEn: optStr(fd, 'badgeTextEn'), taglineAr: optStr(fd, 'taglineAr'), taglineEn: optStr(fd, 'taglineEn'), brandColor: optStr(fd, 'brandColor') ?? undefined, logoUrl: optStr(fd, 'logoUrl'), coverImageUrl: optStr(fd, 'coverImageUrl') });
    const slug = slugify(str(fd, 'slug') || brand.nameEn);
    if (!slug) throw new AppError('VALIDATION', 'Slug is required (latin letters/numbers)');
    const [taken] = await db().select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.slug, slug));
    if (taken) throw new AppError('CONFLICT', `Slug "${slug}" is already used`);
    const [defaultCommission] = await db().select().from(systemSettings).where(eq(systemSettings.key, 'defaults.commissionBps'));
    let r;
    try {
      r = await bootstrapRestaurant(db(), { slug, ...brand, commissionBps: typeof defaultCommission?.value === 'number' ? defaultCommission.value : 500 }, await getDefaultQueueConfig(db()), { defaultPoints: true });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('CONFLICT', `Slug "${slug}" is already used`);
      throw error;
    }
    id = r.id;
    await audit({ actor: actor(auth), action: 'restaurant.created', entity: 'restaurant', entityId: r.id, restaurantId: r.id, after: { slug, ...brand }, ...(await requestMeta()) });
    revalidatePath('/');
    revalidatePath('/admin/restaurants');
  });
  if (res.ok) redirect(`/admin/restaurants/${id}`);
  return res;
}

export async function updateRestaurantAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = uuid(str(fd, 'id'));
    const auth = await requirePermission('platform.restaurants');
    const before = await restaurantOrThrow(id);
    const slug = slugify(str(fd, 'slug'));
    if (!slug) throw new AppError('VALIDATION', 'Slug is required');
    if (slug !== before.slug) {
      const [taken] = await db().select({ id: restaurants.id }).from(restaurants).where(and(eq(restaurants.slug, slug), ne(restaurants.id, id)));
      if (taken) throw new AppError('CONFLICT', `Slug "${slug}" is already used`);
    }
    const commissionPercent = Number(str(fd, 'commissionPercent'));
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 50) throw new AppError('VALIDATION', 'Commission must be 0–50%');
    const hoursRaw = json<unknown>(fd, 'openingHours');
    const openingHours = hoursRaw === null ? null : weeklyHoursSchema.parse(hoursRaw);
    const timezone = str(fd, 'timezone') || 'Africa/Cairo';
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch {
      throw new AppError('VALIDATION', 'Unknown timezone');
    }
    const patch = {
      slug,
      ...restaurantBrandSchema.parse({ nameAr: str(fd, 'nameAr'), nameEn: str(fd, 'nameEn'), badgeText: optStr(fd, 'badgeText'), badgeTextEn: optStr(fd, 'badgeTextEn'), taglineAr: optStr(fd, 'taglineAr'), taglineEn: optStr(fd, 'taglineEn'), brandColor: str(fd, 'brandColor'), logoUrl: optStr(fd, 'logoUrl'), coverImageUrl: optStr(fd, 'coverImageUrl') }),
      phone: optStr(fd, 'phone'),
      timezone,
      orderingStatus: z.enum(['OPEN', 'PAUSED', 'CLOSED']).parse(str(fd, 'orderingStatus')),
      minOrderAmount: money(fd, 'minOrder')!,
      commissionBps: Math.round(commissionPercent * 100),
      requirePhone: bool(fd, 'requirePhone'),
      unpaidTimeoutMinutes: z.number().int().min(0).max(1440).parse(int(fd, 'unpaidTimeoutMinutes')),
      openingHours,
    };
    const changes = diff(before as unknown as Record<string, unknown>, patch);
    if (!changes.changed) return 'Nothing changed';
    try {
      await db().update(restaurants).set({ ...patch, updatedAt: new Date(), version: before.version + 1 }).where(eq(restaurants.id, id));
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('CONFLICT', `Slug "${slug}" is already used`);
      throw error;
    }
    const meta = await requestMeta();
    await audit({ actor: actor(auth), action: 'restaurant.updated', entity: 'restaurant', entityId: id, restaurantId: id, before: changes.before, after: changes.after, ...meta });
    if (patch.commissionBps !== before.commissionBps) {
      await audit({ actor: actor(auth), action: 'restaurant.commission_changed', entity: 'restaurant', entityId: id, restaurantId: id, before: { commissionBps: before.commissionBps }, after: { commissionBps: patch.commissionBps }, ...meta });
    }
    revalidatePath(`/admin/restaurants/${id}`);
    revalidatePath(`/admin/restaurants/${id}/marketing`);
    revalidatePath('/admin/restaurants');
    revalidatePath(`/s/${before.slug}`);
    revalidatePath(`/s/${patch.slug}`);
    revalidatePath('/');
    return 'Saved';
  });
}

/**
 * Platform-level service suspension (e.g. unpaid commission, contract ended). Customers can't order,
 * the merchant can't reopen it, and orders already in progress can still be finished and delivered.
 */
export async function suspendRestaurantAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = uuid(str(fd, 'restaurantId'));
    const auth = await requirePermission('platform.restaurants');
    const before = await restaurantOrThrow(id);
    const reason = z.string().trim().min(3, 'Write a short reason (shown to the restaurant)').max(200).parse(str(fd, 'reason'));
    await db().update(restaurants).set({ isActive: false, suspendedReason: reason, suspendedAt: new Date(), updatedAt: new Date(), version: before.version + 1 }).where(eq(restaurants.id, id));
    await audit({ actor: actor(auth), action: 'restaurant.suspended', entity: 'restaurant', entityId: id, restaurantId: id, before: { isActive: before.isActive }, after: { isActive: false, reason }, ...(await requestMeta()) });
    revalidatePath('/admin/restaurants');
    revalidatePath(`/admin/restaurants/${id}`);
    return 'Service suspended — new orders are blocked';
  });
}

export async function resumeRestaurantAction(restaurantId: string) {
  const id = uuid(restaurantId);
  const auth = await requirePermission('platform.restaurants');
  const before = await restaurantOrThrow(id);
  await db().update(restaurants).set({ isActive: true, suspendedReason: null, suspendedAt: null, updatedAt: new Date(), version: before.version + 1 }).where(eq(restaurants.id, id));
  await audit({ actor: actor(auth), action: 'restaurant.resumed', entity: 'restaurant', entityId: id, restaurantId: id, before: { isActive: before.isActive, reason: before.suspendedReason }, after: { isActive: true }, ...(await requestMeta()) });
  revalidatePath('/admin/restaurants');
  revalidatePath(`/admin/restaurants/${id}`);
}

export async function updatePaymentMethodAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = uuid(str(fd, 'restaurantId'));
    const auth = await requirePermission('platform.restaurants');
    const method = z.enum(['INSTAPAY', 'CASH']).parse(str(fd, 'method'));
    const config = {
      accountName: optStr(fd, 'accountName') ?? undefined,
      address: optStr(fd, 'address') ?? undefined,
      phone: optStr(fd, 'phone') ?? undefined,
      link: optStr(fd, 'link') ? webUrl.parse(str(fd, 'link')) : undefined,
      instructions: optStr(fd, 'instructions') ?? undefined,
      instructionsEn: optStr(fd, 'instructionsEn') ?? undefined,
    };
    const isEnabled = bool(fd, 'isEnabled');
    if (method === 'INSTAPAY' && isEnabled && !config.address && !config.phone) {
      throw new AppError('VALIDATION', 'InstaPay needs an address or phone before it can be enabled');
    }
    const [before] = await db().select().from(restaurantPaymentMethods).where(and(eq(restaurantPaymentMethods.restaurantId, restaurantId), eq(restaurantPaymentMethods.method, method)));
    await db()
      .insert(restaurantPaymentMethods)
      .values({ restaurantId, method, isEnabled, config, sortOrder: method === 'INSTAPAY' ? 0 : 1 })
      .onConflictDoUpdate({ target: [restaurantPaymentMethods.restaurantId, restaurantPaymentMethods.method], set: { isEnabled, config, updatedAt: new Date() } });
    await audit({ actor: actor(auth), action: 'payment_method.updated', entity: 'payment_method', entityId: method, restaurantId, before: before ? { isEnabled: before.isEnabled, config: before.config } : null, after: { isEnabled, config }, ...(await requestMeta()) });
    revalidatePath(`/admin/restaurants/${restaurantId}`);
    return text(await getLocale('staff'), 'تم حفظ طريقة الدفع', 'Payment method saved');
  });
}

export async function saveDeliveryPointAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = uuid(str(fd, 'restaurantId'));
    const auth = await requirePermission('platform.restaurants');
    const id = str(fd, 'id');
    const fulfillmentType = z.enum(FULFILLMENT_TYPES).parse(str(fd, 'fulfillmentType') || 'DELIVERY');
    const values = {
      restaurantId,
      fulfillmentType,
      nameAr: z.string().min(2).parse(str(fd, 'nameAr')),
      nameEn: z.string().min(2).parse(str(fd, 'nameEn')),
      deliveryFee: fulfillmentType === 'PICKUP' ? 0 : money(fd, 'deliveryFee')!,
      extraMinutes: fulfillmentType === 'PICKUP' ? 0 : z.number().int().min(0).max(120).parse(int(fd, 'extraMinutes')),
      isDefault: bool(fd, 'isDefault'),
      isActive: bool(fd, 'isActive'),
      sortOrder: int(fd, 'sortOrder'),
    };
    await db().transaction(async (tx) => {
      // Serialize point edits so two admins cannot select competing defaults.
      const [restaurant] = await tx.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, restaurantId)).for('update');
      if (!restaurant) throw new AppError('NOT_FOUND', 'Restaurant not found');
      if (id) {
        const [existing] = await tx.select({ id: deliveryPoints.id }).from(deliveryPoints).where(and(eq(deliveryPoints.id, uuid(id)), eq(deliveryPoints.restaurantId, restaurantId)));
        if (!existing) throw new AppError('NOT_FOUND', 'Delivery point not found');
      }
      if (values.isDefault && !values.isActive) throw new AppError('VALIDATION', 'المكان الافتراضي لازم يكون متاح');
      if (values.isDefault) await tx.update(deliveryPoints).set({ isDefault: false }).where(eq(deliveryPoints.restaurantId, restaurantId));
      if (id) await tx.update(deliveryPoints).set(values).where(and(eq(deliveryPoints.id, uuid(id)), eq(deliveryPoints.restaurantId, restaurantId)));
      else await tx.insert(deliveryPoints).values(values);
      const active = await tx.select().from(deliveryPoints).where(and(eq(deliveryPoints.restaurantId, restaurantId), eq(deliveryPoints.isActive, true)));
      if (!active.length) throw new AppError('VALIDATION', 'لازم تسيب مكان استلام واحد متاح على الأقل');
      if (!active.some((point) => point.isDefault)) {
        const fallback = active.find((point) => point.fulfillmentType === 'DELIVERY') ?? active[0];
        await tx.update(deliveryPoints).set({ isDefault: false }).where(eq(deliveryPoints.restaurantId, restaurantId));
        await tx.update(deliveryPoints).set({ isDefault: true }).where(eq(deliveryPoints.id, fallback.id));
      }
    });
    await audit({ actor: actor(auth), action: id ? 'delivery_point.updated' : 'delivery_point.created', entity: 'delivery_point', entityId: id || null, restaurantId, after: values });
    revalidatePath(`/admin/restaurants/${restaurantId}`);
    return text(await getLocale('staff'), 'تم حفظ مكان الاستلام', 'Fulfillment point saved');
  });
}

// ---------------------------------------------------------------- queue engine (platform only)

export async function updateQueueConfigAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = uuid(str(fd, 'restaurantId'));
    const auth = await requirePermission('platform.queue');
    await restaurantOrThrow(restaurantId);
    const config = queueConfigSchema.parse(json(fd, 'config'));
    config.capacityRules.sort((a, b) => a.maxLoad - b.maxLoad);
    const before = await getQueueConfig(db(), restaurantId);
    await db()
      .insert(queueConfigs)
      .values({ restaurantId, config, updatedByUserId: auth.user.id })
      .onConflictDoUpdate({ target: queueConfigs.restaurantId, set: { config, updatedAt: new Date(), updatedByUserId: auth.user.id } });
    await audit({ actor: actor(auth), action: 'queue.config_changed', entity: 'queue_config', entityId: restaurantId, restaurantId, before, after: config, ...(await requestMeta()) });
    revalidatePath(`/admin/restaurants/${restaurantId}/queue`);
    return 'Queue configuration saved — applies to orders confirmed from now on';
  });
}

// ---------------------------------------------------------------- menu

export async function saveCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = uuid(str(fd, 'restaurantId'));
    const auth = await requirePermission('menu.manage', restaurantId);
    const id = str(fd, 'id');
    const values = {
      nameAr: z.string().min(1).max(60).parse(str(fd, 'nameAr')),
      nameEn: z.string().min(1).max(60).parse(str(fd, 'nameEn')),
      sortOrder: int(fd, 'sortOrder'),
      isActive: bool(fd, 'isActive'),
      updatedAt: new Date(),
    };
    if (id) await db().update(categories).set(values).where(and(eq(categories.id, uuid(id)), eq(categories.restaurantId, restaurantId)));
    else await db().insert(categories).values({ ...values, restaurantId });
    await audit({ actor: actor(auth), action: id ? 'menu.category_updated' : 'menu.category_created', entity: 'category', entityId: id || null, restaurantId, after: values });
    revalidatePath(`/admin/restaurants/${restaurantId}/menu`);
    return 'Category saved';
  });
}

const variantRowSchema = z.object({
  id: z.string().optional(),
  nameAr: z.string().trim().min(1),
  nameEn: z.string().trim().min(1),
  price: z.union([z.string(), z.number()]),
  prepLoadUnits: z.union([z.string(), z.number()]).optional(),
  isAvailable: z.boolean().default(true),
});
const addonRowSchema = z.object({
  id: z.string().optional(),
  nameAr: z.string().trim().min(1),
  nameEn: z.string().trim().min(1),
  price: z.union([z.string(), z.number()]),
  isAvailable: z.boolean().default(true),
});

export async function saveProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let createdId: string | null = null;
  const restaurantId = str(fd, 'restaurantId');
  const res = await runAction(async () => {
    uuid(restaurantId);
    const auth = await requirePermission('menu.manage', restaurantId);
    const id = str(fd, 'id');
    const categoryId = uuid(str(fd, 'categoryId'));
    const [cat] = await db().select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.restaurantId, restaurantId)));
    if (!cat) throw new AppError('VALIDATION', 'Choose a category');

    const before = id ? (await db().select().from(products).where(and(eq(products.id, uuid(id)), eq(products.restaurantId, restaurantId))))[0] : null;
    if (id && !before) throw new AppError('NOT_FOUND', 'Product not found');
    // Load units feed the platform's queue engine — only platform admins may change them.
    const canLoad = can(auth, 'platform.queue');
    const loadUnits = canLoad ? z.number().int().min(0).max(100).parse(int(fd, 'prepLoadUnits', 1)) : (before?.prepLoadUnits ?? 1);

    const values = {
      categoryId,
      nameAr: z.string().min(1).max(80).parse(str(fd, 'nameAr')),
      nameEn: z.string().min(1).max(80).parse(str(fd, 'nameEn')),
      descriptionAr: optStr(fd, 'descriptionAr'),
      descriptionEn: optStr(fd, 'descriptionEn'),
      imageUrl: restaurantImageUrlSchema.parse(optStr(fd, 'imageUrl')),
      basePrice: money(fd, 'basePrice')!,
      prepLoadUnits: loadUnits,
      sortOrder: int(fd, 'sortOrder'),
      isAvailable: bool(fd, 'isAvailable'),
      isActive: bool(fd, 'isActive'),
      updatedAt: new Date(),
    };
    const variantRows = z.array(variantRowSchema).max(20).parse(json(fd, 'variants') ?? []);
    const groupIds = fd.getAll('addonGroupIds').map((v) => uuid(String(v)));
    if (groupIds.length) {
      const owned = await db().select({ id: addonGroups.id }).from(addonGroups).where(and(inArray(addonGroups.id, groupIds), eq(addonGroups.restaurantId, restaurantId)));
      if (owned.length !== groupIds.length) throw new AppError('VALIDATION', 'Invalid addon group');
    }

    const productId = await db().transaction(async (tx) => {
      let pid: string;
      if (before) {
        await tx.update(products).set({ ...values, version: before.version + 1 }).where(eq(products.id, before.id));
        pid = before.id;
      } else {
        [{ id: pid }] = await tx.insert(products).values({ ...values, restaurantId }).returning({ id: products.id });
      }
      const existing = await tx.select().from(productVariants).where(eq(productVariants.productId, pid));
      const keep = new Set<string>();
      for (const [i, row] of variantRows.entries()) {
        const price = parseMoney(row.price);
        if (price === null) throw new AppError('VALIDATION', `Variant ${row.nameEn}: invalid price`);
        const lu = row.prepLoadUnits === '' || row.prepLoadUnits === undefined ? null : Number(row.prepLoadUnits);
        const match = row.id ? existing.find((v) => v.id === row.id) : undefined;
        const variantLoad = canLoad ? (lu !== null && Number.isFinite(lu) ? Math.max(0, Math.trunc(lu)) : null) : (match?.prepLoadUnits ?? null);
        const v = { nameAr: row.nameAr, nameEn: row.nameEn, price, prepLoadUnits: variantLoad, isAvailable: row.isAvailable, sortOrder: i, isDefault: i === 0 };
        if (match) {
          await tx.update(productVariants).set(v).where(eq(productVariants.id, match.id));
          keep.add(match.id);
        } else {
          await tx.insert(productVariants).values({ ...v, productId: pid });
        }
      }
      const removed = existing.filter((v) => !keep.has(v.id)).map((v) => v.id);
      if (removed.length) await tx.delete(productVariants).where(inArray(productVariants.id, removed));
      await tx.delete(productAddonGroups).where(eq(productAddonGroups.productId, pid));
      if (groupIds.length) await tx.insert(productAddonGroups).values(groupIds.map((g, i) => ({ productId: pid, groupId: g, sortOrder: i })));
      return pid;
    });

    const changes = before ? diff(before as unknown as Record<string, unknown>, values) : { before: null, after: values };
    await audit({
      actor: actor(auth),
      action: before ? (before.basePrice !== values.basePrice ? 'menu.price_changed' : 'menu.product_updated') : 'menu.product_created',
      entity: 'product',
      entityId: productId,
      restaurantId,
      before: changes.before,
      after: { ...changes.after, variants: variantRows.map((v) => ({ name: v.nameEn, price: v.price })) },
      ...(await requestMeta()),
    });
    if (!before) createdId = productId;
    revalidatePath(`/admin/restaurants/${restaurantId}/menu`);
    return 'Product saved';
  });
  if (res.ok && createdId) redirect(`/admin/restaurants/${restaurantId}/menu/products/${createdId}`);
  return res;
}

export async function saveAddonGroupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = uuid(str(fd, 'restaurantId'));
    const auth = await requirePermission('menu.manage', restaurantId);
    const id = str(fd, 'id');
    const minSelect = z.number().int().min(0).max(20).parse(int(fd, 'minSelect'));
    const maxSelect = z.number().int().min(0).max(20).parse(int(fd, 'maxSelect', 1));
    if (maxSelect > 0 && minSelect > maxSelect) throw new AppError('VALIDATION', 'min cannot exceed max');
    const values = {
      nameAr: z.string().min(1).parse(str(fd, 'nameAr')),
      nameEn: z.string().min(1).parse(str(fd, 'nameEn')),
      minSelect,
      maxSelect,
      sortOrder: int(fd, 'sortOrder'),
      isActive: bool(fd, 'isActive'),
    };
    const rows = z.array(addonRowSchema).max(40).parse(json(fd, 'addons') ?? []);
    await db().transaction(async (tx) => {
      let gid: string;
      if (id) {
        const [g] = await tx.select().from(addonGroups).where(and(eq(addonGroups.id, uuid(id)), eq(addonGroups.restaurantId, restaurantId)));
        if (!g) throw new AppError('NOT_FOUND');
        await tx.update(addonGroups).set(values).where(eq(addonGroups.id, g.id));
        gid = g.id;
      } else {
        [{ id: gid }] = await tx.insert(addonGroups).values({ ...values, restaurantId }).returning({ id: addonGroups.id });
      }
      const existing = await tx.select().from(addons).where(eq(addons.groupId, gid));
      const keep = new Set<string>();
      for (const [i, row] of rows.entries()) {
        const price = parseMoney(row.price);
        if (price === null) throw new AppError('VALIDATION', `Addon ${row.nameEn}: invalid price`);
        const v = { nameAr: row.nameAr, nameEn: row.nameEn, price, isAvailable: row.isAvailable, sortOrder: i };
        const match = row.id ? existing.find((a) => a.id === row.id) : undefined;
        if (match) {
          await tx.update(addons).set(v).where(eq(addons.id, match.id));
          keep.add(match.id);
        } else {
          await tx.insert(addons).values({ ...v, groupId: gid });
        }
      }
      const removed = existing.filter((a) => !keep.has(a.id)).map((a) => a.id);
      if (removed.length) await tx.delete(addons).where(inArray(addons.id, removed));
    });
    await audit({ actor: actor(auth), action: id ? 'menu.addon_group_updated' : 'menu.addon_group_created', entity: 'addon_group', entityId: id || null, restaurantId, after: { ...values, addons: rows } });
    revalidatePath(`/admin/restaurants/${restaurantId}/menu`);
    return 'Addon group saved';
  });
}

// ---------------------------------------------------------------- marketing

export async function saveBannerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = uuid(str(fd, 'restaurantId'));
    const auth = await requirePermission('menu.manage', restaurantId);
    const { timezone } = await restaurantOrThrow(restaurantId);
    const id = str(fd, 'id');
    const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
    const values = {
      titleAr: z.string().min(2).max(120).parse(str(fd, 'titleAr')),
      titleEn: optStr(fd, 'titleEn'),
      subtitleAr: optStr(fd, 'subtitleAr'),
      subtitleEn: optStr(fd, 'subtitleEn'),
      imageUrl: restaurantImageUrlSchema.parse(optStr(fd, 'imageUrl')),
      bgColor: color.parse(str(fd, 'bgColor') || '#c2410c'),
      textColor: color.parse(str(fd, 'textColor') || '#ffffff'),
      sortOrder: int(fd, 'sortOrder'),
      isActive: bool(fd, 'isActive'),
      startsAt: dateOrNull(fd, 'startsAt', timezone),
      endsAt: dateOrNull(fd, 'endsAt', timezone),
      updatedAt: new Date(),
    };
    if (id) await db().update(banners).set(values).where(and(eq(banners.id, uuid(id)), eq(banners.restaurantId, restaurantId)));
    else await db().insert(banners).values({ ...values, restaurantId });
    await audit({ actor: actor(auth), action: id ? 'banner.updated' : 'banner.created', entity: 'banner', entityId: id || null, restaurantId, after: values });
    revalidatePath(`/admin/restaurants/${restaurantId}/marketing`);
    return 'Banner saved';
  });
}

export async function deleteBannerAction(restaurantId: string, bannerId: string) {
  const auth = await requirePermission('menu.manage', restaurantId);
  await db().delete(banners).where(and(eq(banners.id, bannerId), eq(banners.restaurantId, restaurantId)));
  await audit({ actor: actor(auth), action: 'banner.deleted', entity: 'banner', entityId: bannerId, restaurantId });
  revalidatePath(`/admin/restaurants/${restaurantId}/marketing`);
}

export async function savePromotionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = uuid(str(fd, 'restaurantId'));
    const auth = await requirePermission('menu.manage', restaurantId);
    const { timezone } = await restaurantOrThrow(restaurantId);
    const id = str(fd, 'id');
    const type = z.enum(PROMOTION_TYPES).parse(str(fd, 'type'));
    const rawValue = str(fd, 'value') || '0';
    const value = type === 'PERCENT' || type === 'PRODUCT_PERCENT' ? Math.round(Number(rawValue) * 100) : (parseMoney(rawValue) ?? 0);
    if (!Number.isFinite(value) || value < 0) throw new AppError('VALIDATION', 'Invalid value');
    if ((type === 'PERCENT' || type === 'PRODUCT_PERCENT') && value > 10_000) throw new AppError('VALIDATION', 'Percent must be ≤ 100');
    const productId = optStr(fd, 'productId');
    if ((type === 'PRODUCT_PERCENT' || type === 'PRODUCT_FIXED') && !productId) throw new AppError('VALIDATION', 'Choose the product');
    if (productId) {
      const [own] = await db().select({ id: products.id }).from(products).where(and(eq(products.id, uuid(productId)), eq(products.restaurantId, restaurantId)));
      if (!own) throw new AppError('VALIDATION', 'Product does not belong to this restaurant');
    }
    const code = optStr(fd, 'code')?.toUpperCase().replace(/[^A-Z0-9_-]/g, '') || null;
    const usageLimitRaw = str(fd, 'usageLimit');
    const values = {
      name: z.string().min(2).max(80).parse(str(fd, 'name')),
      type,
      value,
      productId: productId ? uuid(productId) : null,
      code,
      autoApply: !code && bool(fd, 'autoApply'),
      minSubtotal: money(fd, 'minSubtotal', false) ?? 0,
      maxDiscount: str(fd, 'maxDiscount') ? money(fd, 'maxDiscount') : null,
      startsAt: dateOrNull(fd, 'startsAt', timezone),
      endsAt: dateOrNull(fd, 'endsAt', timezone),
      usageLimit: usageLimitRaw ? z.number().int().min(1).parse(Number(usageLimitRaw)) : null,
      isActive: bool(fd, 'isActive'),
      updatedAt: new Date(),
    };
    if (code) {
      const [clash] = await db()
        .select({ id: promotions.id })
        .from(promotions)
        .where(and(eq(promotions.restaurantId, restaurantId), eq(promotions.code, code), ...(id ? [ne(promotions.id, uuid(id))] : [])));
      if (clash) throw new AppError('CONFLICT', `Code ${code} already exists`);
    }
    if (id) await db().update(promotions).set(values).where(and(eq(promotions.id, uuid(id)), eq(promotions.restaurantId, restaurantId)));
    else await db().insert(promotions).values({ ...values, restaurantId });
    await audit({ actor: actor(auth), action: id ? 'promotion.updated' : 'promotion.created', entity: 'promotion', entityId: id || null, restaurantId, after: values });
    revalidatePath(`/admin/restaurants/${restaurantId}/marketing`);
    return 'Promotion saved';
  });
}

/** Archive (hide from the menu, keep for order history) or restore a product. */
export async function setProductActiveAction(productId: string, active: boolean) {
  const pid = uuid(productId);
  const [p] = await db().select().from(products).where(eq(products.id, pid));
  if (!p) throw new AppError('NOT_FOUND', 'Product not found');
  const auth = await requirePermission('menu.manage', p.restaurantId);
  await db().update(products).set({ isActive: active, updatedAt: new Date(), version: p.version + 1 }).where(eq(products.id, pid));
  await audit({ actor: actor(auth), action: active ? 'menu.product_restored' : 'menu.product_archived', entity: 'product', entityId: pid, restaurantId: p.restaurantId, before: { isActive: p.isActive }, after: { isActive: active } });
  revalidatePath(`/admin/restaurants/${p.restaurantId}/menu`);
}
