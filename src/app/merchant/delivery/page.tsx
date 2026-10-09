import { SharedDeliveryBoard } from '@/components/merchant/shared-delivery-board';
import { merchantContext, storePermissionsFor } from '@/server/merchant-context';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function SharedDeliveryPage() {
  const { auth, restaurants } = await merchantContext('/merchant/delivery');
  const stores = restaurants.map((restaurant) => ({
    id: restaurant.id, nameAr: restaurant.nameAr, nameEn: restaurant.nameEn, timezone: restaurant.timezone,
    permissions: storePermissionsFor(auth, restaurant.id).sort(),
  })).filter((restaurant) => restaurant.permissions.includes('orders.delivery'));
  if (!stores.length) {
    const locale = await getLocale('staff');
    return <p className="p-6 text-center">{text(locale, 'مفيش مطاعم متاحة لحساب التوصيل ده. تواصل مع مسؤول المنصة.', 'No restaurants are assigned to this delivery account. Contact the platform administrator.')}</p>;
  }
  return <SharedDeliveryBoard key={`${auth.user.id}:${stores.map((r) => r.id + r.permissions.join(',')).join('|')}`} userId={auth.user.id} stores={stores} />;
}
