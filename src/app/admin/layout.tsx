import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { pageAuth } from '@/server/auth/session';
import { SafeSignOutForm } from '@/components/safe-sign-out';
import { UtensilsCrossed, LogOut, ExternalLink } from 'lucide-react';
import { AdminNavigation } from '@/components/admin/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import { getLocale } from '@/lib/i18n/server';
import { text, direction } from '@/lib/i18n';
import './admin.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: text(locale, 'إدارة المنصة', 'Platform admin'), robots: { index: false } };
}
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', ar: 'نظرة عامة', en: 'Overview', permission: 'platform.finance', icon: 'LayoutDashboard', primary: true },
  { href: '/admin/restaurants', ar: 'المطاعم', en: 'Restaurants', permission: 'platform.restaurants', icon: 'Store', primary: true },
  { href: '/admin/orders', ar: 'الطلبات', en: 'Orders', permission: 'platform.restaurants', icon: 'ReceiptText', primary: true },
  { href: '/admin/refunds', ar: 'الاسترداد', en: 'Refunds', permission: 'platform.restaurants', icon: 'RotateCcw', primary: true },
  { href: '/admin/qr', ar: 'QR المنصة', en: 'Platform QR', permission: 'platform.restaurants', icon: 'QrCode', primary: true },
  { href: '/admin/finance', ar: 'العمولات والتحصيل', en: 'Finance', permission: 'platform.finance', icon: 'Wallet', primary: true },
  { href: '/admin/customers', ar: 'العملاء', en: 'Customers', permission: 'platform.restaurants', icon: 'Users', primary: false },
  { href: '/admin/users', ar: 'المستخدمون والفريق', en: 'Team members', permission: 'platform.users', icon: 'UserCog', primary: false },
  { href: '/admin/roles', ar: 'الأدوار والصلاحيات', en: 'Roles & permissions', permission: 'platform.users', icon: 'ShieldCheck', primary: false },
  { href: '/admin/audit', ar: 'سجل النشاط', en: 'Activity log', permission: 'platform.audit', icon: 'ScrollText', primary: false },
  { href: '/admin/settings', ar: 'إعدادات المنصة', en: 'System settings', permission: 'platform.settings', icon: 'Settings', primary: false },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await pageAuth('/admin');
  if (!auth.isPlatform) redirect('/merchant');
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  return (
    <div dir={direction(locale)} lang={locale} className="admin-shell min-h-dvh md:flex">
      <aside className="admin-sidebar text-gray-100 md:sticky md:top-0 md:flex md:h-dvh md:shrink-0 md:flex-col">
        <div className="admin-brand">
          <div className="admin-brand-mark"><UtensilsCrossed size={22} strokeWidth={1.5} /></div>
          <div><strong>{t('إدارة المطاعم', 'Restaurant platform')}</strong><small>{t('كل مطاعمك في مكان واحد', 'Your restaurants in one place')}</small></div>
        </div>
        <div className="admin-user">{auth.user.name}<div className="mt-1 opacity-60" dir="ltr">{auth.user.email}</div></div>
        <div className="px-5 pb-5"><LanguageSwitcher className="admin-language-switcher" /></div>
        <nav aria-label={t('إدارة المنصة', 'Platform navigation')} className="admin-navigation no-scrollbar md:overflow-y-auto">
          <AdminNavigation items={NAV.filter(({ permission }) => auth.platformPermissions.has(permission)).map(({ href, ar, en, icon, primary }) => ({ href, ar, en, icon, primary }))} />
        </nav>
        <div className="admin-bottom flex md:block">
          <Link href="/merchant" className="admin-link"><ExternalLink size={17} strokeWidth={1.6} />{t('شاشة طلبات المطعم', 'Kitchen screen')}</Link>
          <SafeSignOutForm><button className="admin-link w-auto"><LogOut size={17} strokeWidth={1.6} />{t('تسجيل الخروج', 'Sign out')}</button></SafeSignOutForm>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8 lg:px-10">
        <div className="admin-content"><div className="admin-topline"><span>{t('تشغيل المطاعم', 'Restaurant operations')}</span><Link href="/" className="flex items-center gap-2">{t('فتح واجهة العميل', 'Open customer menu')} <ExternalLink size={13} /></Link></div>{children}</div>
      </main>
    </div>
  );
}
