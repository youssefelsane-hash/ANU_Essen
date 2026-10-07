import { merchantContext } from '@/server/merchant-context';
import { KitchenBoard } from '@/components/merchant/kitchen-board';

export const dynamic = 'force-dynamic';

export default async function MerchantOrdersPage() {
  const { restaurant, permissions, auth } = await merchantContext('/merchant');
  if (!restaurant) return null;
  if (!permissions.has('orders.view') && !permissions.has('orders.delivery')) {
    return <p className="p-6 text-center">مش مسموح لك تشوف الطلبات.</p>;
  }
  return (
    <KitchenBoard
      userId={auth.user.id}
      restaurant={{ id: restaurant.id, nameAr: restaurant.nameAr, timezone: restaurant.timezone }}
      permissions={[...permissions].sort()}
    />
  );
}
