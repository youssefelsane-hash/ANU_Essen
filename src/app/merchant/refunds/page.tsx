import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { merchantContext } from '@/server/merchant-context';
import { refundQueue } from '@/server/services/refunds';
import { RefundQueue } from '@/components/refund-queue';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function MerchantRefundsPage() {
  const locale = await getLocale('staff');
  const { restaurant, permissions } = await merchantContext('/merchant/refunds');
  if (!restaurant || !permissions.has('payments.refund')) notFound();
  const queue = await refundQueue(db(), restaurant.id);
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-black">{text(locale, 'الاسترداد والمرتجعات', 'Refunds')}</h1>
        <p className="text-sm text-gray-600">{text(locale, 'رجّع الفلوس كلها أو جزء منها من صفحة الطلب. كل استرداد بيتسجل في الحسابات وسجل النشاط والعميل بيشوفه في صفحة تتبع الطلب.', 'Refund all or part of an order from its page. Every refund is recorded in the accounts and activity log, and the customer sees it on the tracking page.')}</p>
      </div>
      <RefundQueue queue={queue} timezone={restaurant.timezone} orderHref={(id) => `/merchant/orders/${id}`} showRestaurant={false} />
    </main>
  );
}
