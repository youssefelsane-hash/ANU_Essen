import Link from 'next/link';
import { ArrowRight, Wallet } from 'lucide-react';
import { db } from '@/server/db';
import { merchantContext } from '@/server/merchant-context';
import { merchantCourierOverview } from '@/server/services/couriers';
import { getLocale } from '@/lib/i18n/server';
import { localizedName, text } from '@/lib/i18n';
import { CourierCashPanel } from '@/components/admin/courier-cash-panel';

export const dynamic = 'force-dynamic';

export default async function MerchantCouriersPage() {
  const { auth, restaurant, permissions } = await merchantContext('/merchant/couriers');
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!restaurant) return <p className="p-6 text-center text-sm">{t('اختار المطعم أولًا.', 'Choose a restaurant first.')}</p>;
  if (!permissions.has('couriers.cash') && !auth.platformPermissions.has('platform.finance')) return <p className="p-6 text-center text-sm">{t('ليس لديك صلاحية مراجعة أو تسجيل عهدة المندوبين.', 'You do not have permission to review or record courier cash hand-ins.')}</p>;
  const report = await merchantCourierOverview(db(), auth, restaurant.id);
  return <main className="mx-auto max-w-6xl space-y-5 p-4 pb-24 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-black"><Wallet size={24} />{t('حسابات المندوبين', 'Courier cash balances')}</h1><p className="mt-2 text-sm text-gray-500">{localizedName(locale, restaurant.nameAr, restaurant.nameEn)}</p></div><Link href="/merchant" className="btn btn-secondary min-h-12"><ArrowRight className={locale === 'en' ? 'rotate-180' : ''} size={18} />{t('رجوع للطلبات', 'Back to orders')}</Link></header>
    <CourierCashPanel key={`${restaurant.id}:${auth.user.id}`} balances={report.balances} handIns={report.handIns} actorUserId={auth.user.id} timezone={restaurant.timezone} showRestaurant={false} />
  </main>;
}
