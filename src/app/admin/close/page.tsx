import { db } from '@/server/db';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { dailyClose } from '@/server/services/stats';
import { dayRange } from '@/server/day-range';
import { DayCloseReport } from '@/components/day-close';
import { Forbidden, PageTitle } from '@/components/admin/ui';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function AdminClosePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const locale = await getLocale();
  if (!(await adminPage('/admin/close', 'platform.finance'))) return <Forbidden />;
  const { day, from, to } = dayRange((await searchParams).date, await platformTimezone());
  const rows = await dailyClose(db(), from, to);
  return (
    <div className="space-y-4">
      <PageTitle title={text(locale, 'إقفال اليوم', 'Close of day')} subtitle={text(locale, 'كل المطاعم في يوم واحد: المبيعات حسب طريقة الدفع، المرتجعات، الكاش مع المندوبين، وحصة المنصة.', 'Every restaurant for one day: sales by payment method, refunds, courier cash and platform share.')} />
      <DayCloseReport rows={rows} day={day} showPlatform />
    </div>
  );
}
