import { CounterOrder } from '@/components/merchant/counter-order';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { db } from '@/server/db';
import { merchantContext } from '@/server/merchant-context';
import { loadPublicMenu } from '@/server/services/menu';

export const dynamic = 'force-dynamic';

export default async function CounterOrderPage() {
  const { auth, restaurant, permissions } = await merchantContext('/merchant/new-order');
  if (!restaurant) return null;
  const locale = await getLocale('staff');
  if (!permissions.has('orders.accept')) return <p className="p-6 text-center">{text(locale, 'لا تملك صلاحية إنشاء طلبات من الكاشير.', 'You do not have permission to create counter orders.')}</p>;
  const menu = await loadPublicMenu(db(), restaurant.slug);
  if (!menu) return <p className="p-6 text-center">{text(locale, 'المنيو غير متاح حاليًا.', 'The menu is currently unavailable.')}</p>;
  return <CounterOrder key={`${restaurant.id}:${auth.user.id}`} menu={menu} userId={auth.user.id} canReceiveCash={permissions.has('payments.verify')} />;
}
