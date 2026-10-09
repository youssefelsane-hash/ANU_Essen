import Link from 'next/link';
import { db } from '@/server/db';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { listTickets } from '@/server/services/support';
import { TicketInbox } from '@/components/support/staff-support';
import { Forbidden, PageTitle } from '@/components/admin/ui';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/support', 'platform.support'))) return <Forbidden />;
  const status = (await searchParams).status === 'all' ? undefined : 'ACTIVE' as const;
  const [tickets, tz] = await Promise.all([listTickets(db(), { restaurantId: null }, status), platformTimezone()]);
  return (
    <div className="space-y-4">
      <PageTitle title={t('الدعم والشكاوى', 'Support & complaints')} subtitle={t('كل الشكاوى في كل المطاعم. المطعم بيشوف شكاوى طلباته ويقدر يرد، وانت بتشوف الكل.', 'Every request across restaurants. Each restaurant sees and answers its own; you see all.')}>
        <Link href={status ? '/admin/support?status=all' : '/admin/support'} className="btn btn-secondary btn-sm">{status ? t('عرض المقفولة كمان', 'Include closed') : t('المفتوحة بس', 'Open only')}</Link>
      </PageTitle>
      <TicketInbox tickets={tickets} basePath="/admin/support" timezone={tz} showRestaurant />
    </div>
  );
}
