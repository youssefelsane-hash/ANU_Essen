import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';
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
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await adminPage(`/admin/orders/${id}`, ['platform.restaurants', 'orders.view']);
  if (!auth) return <Forbidden />;
  const canViewPlatformPricing = auth.platformPermissions.has('platform.finance');
  const [snapshot] = await loadOrderSnapshots(db(), [id], { includePhone: true, includePlatformPricing: canViewPlatformPricing });
  if (!snapshot) notFound();
  const [row] = await db().select().from(orders).where(eq(orders.id, id));
  const r = await getRestaurant(db(), snapshot.restaurantId);
  return (
    <div className="space-y-3">
      <Link href="/admin/orders" className="text-sm text-blue-700">{t("العودة للطلبات", "← Orders")}</Link>
      <OrderDetail
        order={snapshot}
        restaurantName={localizedName(locale, r?.nameAr, r?.nameEn)}
        timezone={r?.timezone ?? 'Africa/Cairo'}
        canPrint
        canCancel={auth.platformPermissions.has('orders.cancel')}
        canRefund={auth.platformPermissions.has('payments.refund')}
        commission={canViewPlatformPricing ? { bps: row.commissionBps, amount: row.commissionAmount, merchantNet: row.merchantNet, source: row.source, serviceFee: row.serviceFee, platformDeliveryFee: row.platformDeliveryFee, platformDeliveryPayer: row.platformDeliveryPayer } : null}
      />
    </div>
  );
}
