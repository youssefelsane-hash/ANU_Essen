'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionState } from '../../lib/action-state';
import { getLocale } from '../../lib/i18n/server';
import { text } from '../../lib/i18n';
import { requirePermission } from '../auth/session';
import { updateRestaurantBrand } from '../services/restaurant-brand';
import { optStr, requestMeta, runAction, str } from './util';

export async function updateMerchantBrandAction(_previous: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const restaurantId = z.uuid().parse(str(fd, 'restaurantId'));
    const auth = await requirePermission('store.profile', restaurantId);
    const restaurant = await updateRestaurantBrand(auth, restaurantId, {
      nameAr: str(fd, 'nameAr'), nameEn: str(fd, 'nameEn'),
      badgeText: optStr(fd, 'badgeText'), badgeTextEn: optStr(fd, 'badgeTextEn'),
      taglineAr: optStr(fd, 'taglineAr'), taglineEn: optStr(fd, 'taglineEn'),
      brandColor: str(fd, 'brandColor'), logoUrl: optStr(fd, 'logoUrl'), coverImageUrl: optStr(fd, 'coverImageUrl'),
    }, await requestMeta());
    revalidatePath('/merchant', 'layout');
    revalidatePath(`/s/${restaurant.slug}`, 'layout');
    revalidatePath('/');
    revalidatePath('/admin/restaurants');
    revalidatePath(`/admin/restaurants/${restaurant.id}`);
    return text(await getLocale('staff'), 'تم حفظ اسم وشكل المطعم.', 'Restaurant appearance saved.');
  });
}
