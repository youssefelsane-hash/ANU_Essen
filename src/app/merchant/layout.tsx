import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { merchantContext } from '@/server/merchant-context';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { MerchantNavigation, MerchantSuspensionNotice } from '@/components/merchant/navigation';
import { SafeSignOutForm } from '@/components/safe-sign-out';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale('staff');
  return {
    title: text(locale, 'إدارة المطعم', 'Restaurant workspace'),
    manifest: `/merchant/manifest.webmanifest?lang=${locale}`,
    robots: { index: false },
    appleWebApp: { capable: true, title: text(locale, 'الطلبات', 'Orders'), statusBarStyle: 'default' },
  };
}
export const viewport: Viewport = { themeColor: '#172c22' };
export const dynamic = 'force-dynamic';

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { auth, restaurants, restaurant, permissions } = await merchantContext('/merchant');
  if (!restaurant) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <p className="mb-4">{t('الحساب غير مرتبط بمطعم.', 'This account has no restaurant assigned.')}</p>
        {auth.isPlatform && <Link className="btn btn-primary" href="/admin">{t('إدارة المنصة', 'Platform')}</Link>}
        <SafeSignOutForm className="mt-4"><button className="btn btn-secondary">{t('تسجيل خروج', 'Sign out')}</button></SafeSignOutForm>
      </main>
    );
  }
  const links = [
    { href: '/merchant', ar: 'الطلبات', en: 'Orders', show: permissions.has('orders.view') || permissions.has('orders.delivery') },
    { href: '/merchant/new-order', ar: 'طلب من الكاشير', en: 'Counter order', show: permissions.has('orders.accept') },
    { href: '/merchant/dashboard', ar: 'ملخص اليوم', en: 'Today', show: permissions.has('reports.view') },
    { href: '/merchant/menu', ar: 'الأصناف والأسعار', en: 'Menu & prices', show: permissions.has('menu.availability') || permissions.has('menu.manage') },
    { href: '/merchant/staff', ar: 'الفريق', en: 'Team', show: permissions.has('staff.manage') },
  ];
  return (
    <div className="min-h-dvh">
      <MerchantNavigation restaurant={restaurant} restaurants={restaurants} links={links.filter((link) => link.show)} userName={auth.user.name} isPlatform={auth.isPlatform} />
      {!restaurant.isActive && <MerchantSuspensionNotice reason={restaurant.suspendedReason} />}
      {children}
      <ServiceWorkerRegister />
    </div>
  );
}
