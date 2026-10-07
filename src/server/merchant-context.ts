import { asc, inArray } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db } from './db';
import { restaurants } from './db/schema';
import { pageAuth } from './auth/session';
import type { AuthContext } from './auth/authz';
import { STORE_PERMISSIONS } from '../lib/domain/permissions';

export const MERCHANT_STORE_COOKIE = 'merchant_store';

export interface MerchantStoreRef {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  timezone: string;
  isActive: boolean;
  suspendedReason: string | null;
}

/** Store-level permissions the user holds in a restaurant (platform admins hold all of them everywhere). */
export function storePermissionsFor(auth: AuthContext, restaurantId: string): string[] {
  const set = new Set<string>(auth.storePermissions.get(restaurantId) ?? []);
  for (const p of STORE_PERMISSIONS) if (auth.platformPermissions.has(p)) set.add(p);
  return [...set];
}

export async function merchantContext(path: string) {
  const auth = await pageAuth(path);
  const cols = { id: restaurants.id, slug: restaurants.slug, nameAr: restaurants.nameAr, nameEn: restaurants.nameEn, timezone: restaurants.timezone, isActive: restaurants.isActive, suspendedReason: restaurants.suspendedReason };
  let list: MerchantStoreRef[];
  if (auth.platformPermissions.has('platform.restaurants')) {
    list = await db().select(cols).from(restaurants).orderBy(asc(restaurants.nameAr));
  } else if (auth.storeIds.length) {
    list = await db().select(cols).from(restaurants).where(inArray(restaurants.id, auth.storeIds)).orderBy(asc(restaurants.nameAr));
  } else {
    list = [];
  }
  const chosen = (await cookies()).get(MERCHANT_STORE_COOKIE)?.value;
  const restaurant = list.find((r) => r.id === chosen) ?? list[0] ?? null;
  const permissions = restaurant ? storePermissionsFor(auth, restaurant.id) : [];
  return { auth, restaurants: list, restaurant, permissions: new Set(permissions) };
}
