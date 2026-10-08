import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hasPermission } from '../../lib/domain/permissions';
import { restaurantBrandSchema, type RestaurantBrand } from '../../lib/domain/restaurant-brand';
import type { AuthContext } from '../auth/authz';
import { db, type Db } from '../db';
import { media, restaurants } from '../db/schema';
import { AppError } from '../errors';
import { audit, diff } from './audit';

/** Public uploaded photos still have a restaurant owner; a forged media id cannot change that scope. */
export async function assertBrandImageOwnership(d: Db, restaurantId: string, value: string | null | undefined) {
  if (!value) return;
  let path: string;
  try { path = decodeURIComponent(new URL(value, 'https://local.invalid').pathname); }
  catch { throw new AppError('VALIDATION', 'راجع رابط الصورة وحاول تاني.'); }
  if (/^\/(?:api|admin|merchant)(?:\/|$)/i.test(path)) throw new AppError('VALIDATION', 'استخدم صورة من جهازك أو رابط صورة مباشر.');
  if (!path.startsWith('/media/')) return;
  const id = path.slice('/media/'.length);
  if (!z.uuid().safeParse(id).success) throw new AppError('VALIDATION', 'راجع رابط الصورة وحاول تاني.');
  const [image] = await d.select({ restaurantId: media.restaurantId }).from(media).where(eq(media.id, id));
  if (!image || image.restaurantId !== restaurantId) throw new AppError('FORBIDDEN', 'استخدم صورة مرفوعة للمطعم ده.');
}

function brandFields(row: RestaurantBrand): RestaurantBrand {
  return {
    nameAr: row.nameAr, nameEn: row.nameEn, badgeText: row.badgeText ?? null, badgeTextEn: row.badgeTextEn ?? null,
    taglineAr: row.taglineAr ?? null, taglineEn: row.taglineEn ?? null, brandColor: row.brandColor,
    logoUrl: row.logoUrl ?? null, coverImageUrl: row.coverImageUrl ?? null,
  };
}

/** Store self-service deliberately accepts appearance only; platform settings are never writable here. */
export async function updateRestaurantBrand(auth: AuthContext, restaurantId: string, input: unknown, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  if (!hasPermission(auth, 'store.profile', restaurantId)) throw new AppError('FORBIDDEN');
  const brand = brandFields(restaurantBrandSchema.parse(input));
  return db().transaction(async (tx) => {
    const [restaurant] = await tx.select().from(restaurants).where(eq(restaurants.id, restaurantId)).for('update');
    if (!restaurant) throw new AppError('NOT_FOUND');
    await Promise.all([
      assertBrandImageOwnership(tx, restaurantId, brand.logoUrl),
      assertBrandImageOwnership(tx, restaurantId, brand.coverImageUrl),
    ]);
    const changes = diff(brandFields(restaurant), brand);
    if (changes.changed) {
      await tx.update(restaurants).set({ ...brand, updatedAt: new Date(), version: sql`${restaurants.version} + 1` }).where(eq(restaurants.id, restaurantId));
      await audit({ actor: { type: 'USER', userId: auth.user.id, label: auth.user.name }, action: 'restaurant.brand_updated', entity: 'restaurant', entityId: restaurantId, restaurantId, before: changes.before, after: changes.after, ...meta }, tx);
    }
    return { id: restaurant.id, slug: restaurant.slug };
  });
}
