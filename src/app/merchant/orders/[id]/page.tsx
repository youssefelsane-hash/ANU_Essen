import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { merchantContext } from '@/server/merchant-context';
import { loadOrderSnapshots } from '@/server/services/order-views';
import { OrderDetail } from '@/components/order-detail';

export const dynamic = 'force-dynamic';

export default async function MerchantOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { restaurant, permissions } = await merchantContext(`/merchant/orders/${id}`);
  if (!restaurant || !(permissions.has('orders.view') || permissions.has('reports.view'))) notFound();
  const [order] = await loadOrderSnapshots(db(), [id], { includePhone: permissions.has('orders.accept') || permissions.has('payments.verify') });
  if (!order || order.restaurantId !== restaurant.id) notFound();
  return (
    <main className="mx-auto max-w-6xl space-y-3 p-4">
      <Link href="/merchant/dashboard" className="text-sm text-blue-700">→ رجوع</Link>
      <OrderDetail order={order} restaurantName={restaurant.nameAr} timezone={restaurant.timezone} canPrint={permissions.has('receipts.print')} />
    </main>
  );
}
