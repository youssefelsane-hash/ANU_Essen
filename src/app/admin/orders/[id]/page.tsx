import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { orders } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant } from '@/server/services/store';
import { loadOrderSnapshots } from '@/server/services/order-views';
import { OrderDetail } from '@/components/order-detail';
import { Forbidden } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await adminPage(`/admin/orders/${id}`, 'platform.restaurants');
  if (!auth) return <Forbidden />;
  const [snapshot] = await loadOrderSnapshots(db(), [id], { includePhone: true });
  if (!snapshot) notFound();
  const [row] = await db().select().from(orders).where(eq(orders.id, id));
  const r = await getRestaurant(db(), snapshot.restaurantId);
  return (
    <div className="space-y-3" dir="rtl">
      <Link href="/admin/orders" className="text-sm text-blue-700" dir="ltr">← Orders</Link>
      <OrderDetail
        order={snapshot}
        restaurantName={r?.nameAr ?? ''}
        timezone={r?.timezone ?? 'Africa/Cairo'}
        canPrint
        commission={auth.platformPermissions.has('platform.finance') ? { bps: row.commissionBps, amount: row.commissionAmount, merchantNet: row.merchantNet, source: row.source } : null}
      />
    </div>
  );
}
