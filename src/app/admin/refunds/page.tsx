import { db } from '@/server/db';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { refundQueue } from '@/server/services/refunds';
import { RefundQueue } from '@/components/refund-queue';
import { Forbidden, PageTitle } from '@/components/admin/ui';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function AdminRefundsPage() {
  const locale = await getLocale();
  if (!(await adminPage('/admin/refunds', 'platform.restaurants'))) return <Forbidden />;
  const [queue, tz] = await Promise.all([refundQueue(db(), null), platformTimezone()]);
  return (
    <div className="space-y-4">
      <PageTitle
        title={text(locale, 'الاسترداد في كل المطاعم', 'Refunds across restaurants')}
        subtitle={text(locale, 'المطعم هو اللي بيرجّع الفلوس للعميل؛ عمولة المنصة على الجزء المسترد بتتخصم تلقائيًا.', 'Restaurants give the money back; the platform commission on refunded amounts is reversed automatically.')}
      />
      <RefundQueue queue={queue} timezone={tz} orderHref={(id) => `/admin/orders/${id}`} showRestaurant />
    </div>
  );
}
