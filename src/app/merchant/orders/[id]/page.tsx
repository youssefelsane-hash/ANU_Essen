import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { merchantContext } from '@/server/merchant-context';
import { loadOrderSnapshots } from '@/server/services/order-views';
import { OrderDetail } from '@/components/order-detail';
import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function MerchantOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale('staff');
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { restaurant, permissions } = await merchantContext(`/merchant/orders/${id}`);
  if (!restaurant || !(permissions.has('orders.view') || permissions.has('reports.view'))) notFound();
  const [order] = await loadOrderSnapshots(db(), [id], { includePhone: permissions.has('orders.accept') || permissions.has('payments.verify') || permissions.has('payments.refund') });
  if (!order || order.restaurantId !== restaurant.id) notFound();
  return (
    <main className="mx-auto max-w-6xl space-y-3 p-4">
      <Link href={permissions.has('reports.view') ? '/merchant/dashboard' : '/merchant'} className="text-sm text-blue-700">{text(locale, '← رجوع', '← Back')}</Link>
      <OrderDetail order={order} restaurantName={localizedName(locale, restaurant.nameAr, restaurant.nameEn)} timezone={restaurant.timezone} canPrint={permissions.has('receipts.print')} canRefund={permissions.has('payments.refund')} canCancel={permissions.has('orders.cancel')} />
    </main>
  );
}
