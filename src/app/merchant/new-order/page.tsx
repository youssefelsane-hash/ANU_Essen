import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { merchantContext } from '@/server/merchant-context';
import { loadPublicMenu } from '@/server/services/menu';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { CounterOrder } from '@/components/merchant/counter-order';

export const dynamic = 'force-dynamic';

export default async function NewCounterOrderPage() {
  const { auth, restaurant, permissions } = await merchantContext('/merchant/new-order');
  if (!restaurant) return null;
  const locale = await getLocale('staff');
  if (!permissions.has('orders.create')) {
    return <p className="p-6 text-center">{text(locale, 'مش مسموح لك تسجّل طلبات من الكاشير.', 'You are not allowed to record counter orders.')}</p>;
  }
  // Walk-in orders never carry the online all-in price, so this cashier view
  // intentionally receives the restaurant's counter prices.
  const menu = await loadPublicMenu(db(), restaurant.slug, { customerPrices: false });
  if (!menu) notFound();
  return (
    <CounterOrder
      key={`${restaurant.id}:${auth.user.id}`}
      menu={menu}
      userId={auth.user.id}
      restaurant={{ id: restaurant.id, nameAr: restaurant.nameAr, nameEn: restaurant.nameEn, timezone: restaurant.timezone }}
      canPrint={permissions.has('receipts.print')}
    />
  );
}
