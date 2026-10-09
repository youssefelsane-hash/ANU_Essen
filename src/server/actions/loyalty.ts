'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '../auth/session';
import { db } from '../db';
import { restaurants } from '../db/schema';
import { AppError } from '../errors';
import { audit } from '../services/audit';
import { bool, int, requestMeta, runAction, str } from './util';
import { parseMoney } from '../../lib/domain/misc';
import type { ActionState } from '../../lib/action-state';

/** Platform owner turns the ELSANE game on/off for a restaurant and sets the prize. */
export async function saveLoyaltyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = z.uuid().parse(str(fd, 'restaurantId'));
    const auth = await requirePermission('platform.restaurants');
    const reward = parseMoney(str(fd, 'reward') || '0');
    const minOrder = parseMoney(str(fd, 'minOrder') || '0');
    if (!reward || reward > 50_000) throw new AppError('VALIDATION', 'قيمة الخصم لازم تكون من 1 لـ 500 ج.م');
    if (minOrder === null || minOrder > 100_000) throw new AppError('VALIDATION', 'راجع أقل قيمة للطلب');
    const patch = {
      loyaltyEnabled: bool(fd, 'enabled'),
      loyaltyReward: reward,
      loyaltyMinOrder: minOrder,
      loyaltyVoucherDays: z.number().int().min(1).max(365).parse(int(fd, 'voucherDays', 30)),
    };
    const [before] = await db().select({ loyaltyEnabled: restaurants.loyaltyEnabled, loyaltyReward: restaurants.loyaltyReward, loyaltyMinOrder: restaurants.loyaltyMinOrder, loyaltyVoucherDays: restaurants.loyaltyVoucherDays, slug: restaurants.slug })
      .from(restaurants).where(eq(restaurants.id, restaurantId));
    if (!before) throw new AppError('NOT_FOUND');
    await db().update(restaurants).set({ ...patch, updatedAt: new Date() }).where(eq(restaurants.id, restaurantId));
    await audit({ actor: { type: 'USER', userId: auth.user.id, label: auth.user.name }, action: patch.loyaltyEnabled ? 'loyalty.configured' : 'loyalty.disabled', entity: 'restaurant', entityId: restaurantId, restaurantId, before, after: patch, ...(await requestMeta()) });
    revalidatePath(`/admin/restaurants/${restaurantId}/marketing`);
    revalidatePath(`/s/${before.slug}`);
    return 'تم الحفظ';
  });
}
