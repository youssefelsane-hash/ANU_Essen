import { redirect } from 'next/navigation';
import { isDeliveryOnly } from '@/server/auth/authz';
import { merchantContext } from '@/server/merchant-context';
import { KitchenBoard } from '@/components/merchant/kitchen-board';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function MerchantOrdersPage() {
  const locale = await getLocale('staff');
  const { restaurant, permissions, auth } = await merchantContext('/merchant');
  if (isDeliveryOnly(auth)) redirect('/merchant/delivery');
  if (!restaurant) return null;
  if (!permissions.has('orders.view') && !permissions.has('orders.delivery')) {
    return <p className="p-6 text-center">{text(locale, 'لا تملك صلاحية عرض الطلبات.', 'You do not have permission to view orders.')}</p>;
  }
  return (
    <KitchenBoard
      userId={auth.user.id}
      restaurant={{ id: restaurant.id, nameAr: restaurant.nameAr, nameEn: restaurant.nameEn, timezone: restaurant.timezone }}
      permissions={[...permissions].sort()}
    />
  );
}
