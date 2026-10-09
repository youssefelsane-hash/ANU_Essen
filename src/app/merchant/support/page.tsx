import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { merchantContext } from '@/server/merchant-context';
import { listTickets } from '@/server/services/support';
import { TicketInbox } from '@/components/support/staff-support';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function MerchantSupportPage() {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { restaurant, permissions } = await merchantContext('/merchant/support');
  if (!restaurant || !permissions.has('support.manage')) notFound();
  const tickets = await listTickets(db(), { restaurantId: restaurant.id });
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black">{t('الشكاوى', 'Complaints')}</h1>
          <p className="text-sm text-gray-600">{t('شكاوى العملاء عن طلبات مطعمك. رد عليهم من هنا؛ فريق المنصة شايفها كمان.', 'Customer complaints about your orders. Reply here; the platform team sees them too.')}</p>
        </div>
        <Link href="/merchant/reviews" className="btn btn-secondary btn-sm">{t('التقييمات ★', 'Ratings ★')}</Link>
      </div>
      <TicketInbox tickets={tickets} basePath="/merchant/support" timezone={restaurant.timezone} showRestaurant={false} />
    </main>
  );
}
