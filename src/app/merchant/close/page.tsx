import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { merchantContext } from '@/server/merchant-context';
import { dailyClose } from '@/server/services/stats';
import { dayRange } from '@/server/day-range';
import { DayCloseReport } from '@/components/day-close';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function MerchantClosePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const locale = await getLocale('staff');
  const { restaurant, permissions } = await merchantContext('/merchant/close');
  if (!restaurant || !permissions.has('reports.view')) notFound();
  const { day, from, to } = dayRange((await searchParams).date, restaurant.timezone);
  const rows = await dailyClose(db(), from, to, restaurant.id);
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-black">{text(locale, 'إقفال اليوم', 'Close of day')}</h1>
        <p className="text-sm text-gray-600">{text(locale, 'آخر الوردية: راجع الطلبات المفتوحة والتحويلات وكاش المندوبين، وقارن الأرقام بالدرج وحساب إنستاباي.', 'End of shift: check open orders, transfers and courier cash, then compare with the drawer and the InstaPay account.')}</p>
      </div>
      <DayCloseReport rows={rows} day={day} showPlatform={false} />
    </main>
  );
}
