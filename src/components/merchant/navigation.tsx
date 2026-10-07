'use client';

import Link from 'next/link';
import { useLanguage } from '@/components/language-provider';
import { LanguageSwitcher } from '@/components/language-switcher';
import { SafeSignOutForm } from '@/components/safe-sign-out';
import { localizedName } from '@/lib/i18n';
import { selectStoreAction } from '@/server/actions/merchant';
import type { MerchantStoreRef } from '@/server/merchant-context';

interface Props {
  restaurant: MerchantStoreRef;
  restaurants: MerchantStoreRef[];
  links: { href: string; ar: string; en: string }[];
  userName: string;
  isPlatform: boolean;
}

/** Client labels follow language changes even when the saved order screen reopens offline. */
export function MerchantNavigation({ restaurant, restaurants, links, userName, isPlatform }: Props) {
  const { locale, t } = useLanguage();
  return (
    <nav aria-label={t('إدارة المطعم', 'Restaurant navigation')} className="merchant-nav space-y-2 px-4 py-3 text-sm text-white" style={{ height: 'auto' }}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="me-auto min-w-0 truncate font-extrabold">{localizedName(locale, restaurant.nameAr, restaurant.nameEn)}</span>
        <LanguageSwitcher />
        <details className="relative shrink-0">
          <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm">{t('الحساب', 'Account')}</summary>
          <div className="absolute end-0 top-full z-30 mt-2 w-64 space-y-3 rounded-xl bg-white p-4 text-gray-900 shadow-xl ring-1 ring-gray-200">
            <p className="font-bold">{userName}</p>
            {restaurants.length > 1 && (
              <form action={selectStoreAction} className="space-y-2">
                <label className="label" htmlFor="merchant-store">{t('اختيار المطعم', 'Choose restaurant')}</label>
                <select id="merchant-store" name="restaurantId" defaultValue={restaurant.id} className="input">
                  {restaurants.map((r) => <option key={r.id} value={r.id}>{localizedName(locale, r.nameAr, r.nameEn)}</option>)}
                </select>
                <button className="btn btn-secondary btn-sm w-full">{t('فتح المطعم', 'Open restaurant')}</button>
              </form>
            )}
            {isPlatform && <Link href="/admin" className="btn btn-secondary btn-sm w-full">{t('إدارة المنصة', 'Platform')}</Link>}
            <SafeSignOutForm><button className="btn btn-ghost btn-sm w-full">{t('تسجيل خروج', 'Sign out')}</button></SafeSignOutForm>
          </div>
        </details>
      </div>
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
        {links.map((link) => <Link key={link.href} href={link.href} className="min-h-10 shrink-0 rounded-lg px-3 py-2.5 font-semibold hover:bg-white/10">{t(link.ar, link.en)}</Link>)}
      </div>
    </nav>
  );
}

export function MerchantSuspensionNotice({ reason }: { reason: string | null }) {
  const { t } = useLanguage();
  return <div className="bg-red-700 px-4 py-2 text-center text-sm font-semibold text-white" role="alert">
    {t('الخدمة موقوفة من إدارة المنصة. أكملوا الطلبات الحالية؛ الطلبات الجديدة متوقفة.', 'The platform has paused this restaurant. Finish existing orders; new orders are paused.')}{reason ? ` — ${reason}` : ''}
  </div>;
}
