'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/components/language-provider';
import { LanguageSwitcher } from '@/components/language-switcher';
import { SafeSignOutForm } from '@/components/safe-sign-out';
import { localizedName } from '@/lib/i18n';
import { selectStoreAction } from '@/server/actions/merchant';
import type { MerchantStoreRef } from '@/server/merchant-context';
import './merchant-navigation.css';

interface Props {
  restaurant: MerchantStoreRef;
  restaurants: MerchantStoreRef[];
  links: { href: string; ar: string; en: string; count?: number }[];
  userName: string;
  isPlatform: boolean;
}

/** Client labels follow language changes even when the saved order screen reopens offline. */
export function MerchantNavigation({ restaurant, restaurants, links, userName, isPlatform }: Props) {
  const { locale, t } = useLanguage();
  const pathname = usePathname();
  const deliveryWorkspace = pathname.startsWith('/merchant/delivery');
  const mainLinks = links.filter((link) => link.href === '/merchant' || link.href === '/merchant/new-order' || link.href === '/merchant/delivery');
  const heading = deliveryWorkspace ? t('طلبات التوصيل', 'Deliveries') : localizedName(locale, restaurant.nameAr, restaurant.nameEn);
  const moreLinks = links.filter((link) => !mainLinks.includes(link));
  return (
    <nav aria-label={t('إدارة المطعم', 'Restaurant navigation')} className="merchant-nav text-sm text-white" style={{ height: 'auto' }}>
      <div className="merchant-mobile-nav">
        <strong className="min-w-0 flex-1 truncate">{heading}</strong>
        {mainLinks.some((link) => link.href === '/merchant/new-order') && <Link href="/merchant/new-order" className="shrink-0 rounded-lg bg-white/10 px-3 py-2 font-bold">{t('+ طلب', '+ Order')}</Link>}
        <details className="relative shrink-0">
          <summary className="cursor-pointer rounded-lg px-3 py-2 font-bold">{t('القائمة', 'Menu')} ☰</summary>
          <div className="absolute end-0 top-full z-40 mt-3 grid w-72 max-w-[calc(100vw-24px)] gap-1 rounded-2xl bg-white p-3 text-gray-900 shadow-xl ring-1 ring-gray-200">
            {links.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined} onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')} className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-2 font-bold hover:bg-gray-100">{t(link.ar, link.en)}{link.count ? <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs">{link.count}</span> : null}</Link>)}
            <div className="my-1 border-t border-gray-200 pt-3"><LanguageSwitcher /></div>
            {!deliveryWorkspace && restaurants.length > 1 && <form action={selectStoreAction} className="space-y-2 border-t border-gray-200 py-2"><label className="label" htmlFor="mobile-merchant-store">{t('اختيار المطعم', 'Choose restaurant')}</label><select id="mobile-merchant-store" name="restaurantId" defaultValue={restaurant.id} className="input">{restaurants.map((r) => <option key={r.id} value={r.id}>{localizedName(locale, r.nameAr, r.nameEn)}</option>)}</select><button className="btn btn-secondary w-full">{t('فتح المطعم', 'Open restaurant')}</button></form>}
            <p className="mt-2 border-t border-gray-200 pt-3 text-xs text-gray-500">{userName}</p>
            {isPlatform && <Link href="/admin" className="btn btn-secondary mt-1">{t('إدارة المنصة', 'Platform')}</Link>}
            <SafeSignOutForm><button className="btn btn-ghost mt-1 w-full">{t('تسجيل خروج', 'Sign out')}</button></SafeSignOutForm>
          </div>
        </details>
      </div>
      <div className="merchant-desktop-nav space-y-2 px-4 py-3"><div className="flex flex-wrap items-center gap-3">
        <span className="me-auto min-w-0 truncate font-extrabold">{heading}</span>
        <LanguageSwitcher />
        <details className="relative shrink-0">
          <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm">{t('الحساب', 'Account')}</summary>
          <div className="absolute end-0 top-full z-30 mt-2 w-64 space-y-3 rounded-xl bg-white p-4 text-gray-900 shadow-xl ring-1 ring-gray-200">
            <p className="font-bold">{userName}</p>
            {!deliveryWorkspace && restaurants.length > 1 && (
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
      <div className="flex min-w-0 items-stretch gap-1">
        {mainLinks.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined} className={'flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-xl px-2 py-2 text-center font-bold hover:bg-white/10 ' + (pathname === link.href ? 'bg-white/15' : '')}>{t(link.ar, link.en)}</Link>)}
        {moreLinks.length > 0 && <details className="relative min-w-0 flex-1">
          <summary className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl px-2 py-2 text-center font-bold hover:bg-white/10">{t('إدارة المطعم', 'Manage')}{moreLinks.some((link) => !!link.count) && <span className="ms-1.5 size-2 rounded-full bg-amber-400" />}</summary>
          <div className="absolute end-0 top-full z-30 mt-2 grid w-64 max-w-[calc(100vw-32px)] gap-1 rounded-xl bg-white p-2 text-gray-900 shadow-xl ring-1 ring-gray-200">
            {moreLinks.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined} onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')} className="flex min-h-12 items-center justify-between gap-2 rounded-lg px-3 py-2 font-semibold hover:bg-gray-100">{t(link.ar, link.en)}{link.count ? <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-black" aria-label={t(`${link.count} طلب مستني`, `${link.count} waiting`)}>{link.count}</span> : null}</Link>)}
          </div>
        </details>}
      </div>
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
