import Link from 'next/link';
import { Truck, Wallet } from 'lucide-react';
import { pageAuth } from '@/server/auth/session';
import { db } from '@/server/db';
import { platformTimezone } from '@/server/admin-guard';
import { platformCourierOverview } from '@/server/services/couriers';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { Forbidden, PageTitle } from '@/components/admin/ui';
import { CourierManagement } from '@/components/admin/courier-management';
import { CourierCashPanel } from '@/components/admin/courier-cash-panel';

export const dynamic = 'force-dynamic';

export default async function DeliveryAdminPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const auth = await pageAuth('/admin/delivery');
  const canManage = auth.platformPermissions.has('platform.users');
  const canFinance = auth.platformPermissions.has('platform.finance');
  if (!canManage && !canFinance) return <Forbidden />;
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { view } = await searchParams;
  const cashView = canFinance && (view === 'cash' || !canManage);
  const [overview, timezone] = await Promise.all([platformCourierOverview(db(), auth), platformTimezone()]);
  return <div className="space-y-5">
    <PageTitle title={t('المندوبون والتحصيل', 'Couriers & cash hand-ins')} subtitle={t('وزّع المندوبين على المطاعم، وتابع الكاش المستلم من كل مندوب لكل مطعم.', 'Assign couriers to restaurants and track cash handed in by each courier for each restaurant.')} />
    <nav className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={t('إدارة التوصيل', 'Delivery management')}>
      {canManage && <Link href="/admin/delivery" aria-current={!cashView ? 'page' : undefined} className={`btn min-h-12 ${!cashView ? 'btn-dark' : 'btn-secondary'}`}><Truck size={18} />{t('المندوبون والمطاعم', 'Couriers & restaurants')}</Link>}
      {canFinance && <Link href="/admin/delivery?view=cash" aria-current={cashView ? 'page' : undefined} className={`btn min-h-12 ${cashView ? 'btn-dark' : 'btn-secondary'}`}><Wallet size={18} />{t('استلام الكاش والحسابات', 'Cash hand-ins & balances')}</Link>}
    </nav>
    {cashView ? <CourierCashPanel balances={overview.balances} handIns={overview.handIns} actorUserId={auth.user.id} timezone={timezone} /> : <CourierManagement couriers={overview.couriers} candidates={overview.candidates} restaurants={overview.restaurants} actorUserId={auth.user.id} />}
  </div>;
}
