import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { merchantContext, storePermissionsFor } from '@/server/merchant-context';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { MerchantNavigation, MerchantSuspensionNotice } from '@/components/merchant/navigation';
import { SafeSignOutForm } from '@/components/safe-sign-out';
import { db } from '@/server/db';
import { openRefundRequestCount } from '@/server/services/refunds';
import { openTicketCount } from '@/server/services/support';

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
  const [refundRequests, openTickets] = await Promise.all([
    permissions.has('payments.refund') ? openRefundRequestCount(db(), restaurant.id) : 0,
    permissions.has('support.manage') ? openTicketCount(db(), restaurant.id) : 0,
  ]);
  const canDeliver = restaurants.some((store) => storePermissionsFor(auth, store.id).includes('orders.delivery'));
  const links = [
    { href: '/merchant/delivery', ar: 'طلبات التوصيل', en: 'Deliveries', show: canDeliver },
    { href: '/merchant/couriers', ar: 'حسابات الديليفري', en: 'Courier accounts', show: permissions.has('couriers.cash') || auth.platformPermissions.has('platform.finance') },
    { href: '/merchant', ar: 'الطلبات', en: 'Orders', show: permissions.has('orders.view') || permissions.has('orders.delivery') },
    { href: '/merchant/new-order', ar: 'طلب من الكاشير', en: 'Counter order', show: permissions.has('orders.create') },
    { href: '/merchant/dashboard', ar: 'ملخص اليوم', en: 'Today', show: permissions.has('reports.view') },
    { href: '/merchant/close', ar: 'إقفال اليوم', en: 'Close of day', show: permissions.has('reports.view') },
    { href: '/merchant/menu', ar: 'الأصناف والأسعار', en: 'Menu & prices', show: permissions.has('menu.availability') || permissions.has('menu.manage') },
    { href: '/merchant/appearance', ar: 'اسم وشكل المطعم', en: 'Restaurant appearance', show: permissions.has('store.profile') },
    { href: '/merchant/refunds', ar: 'الاسترداد', en: 'Refunds', show: permissions.has('payments.refund'), count: refundRequests },
    { href: '/merchant/support', ar: 'الشكاوى والتقييمات', en: 'Complaints & ratings', show: permissions.has('support.manage'), count: openTickets },
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
