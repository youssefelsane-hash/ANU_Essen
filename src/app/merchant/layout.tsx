import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { merchantContext } from '@/server/merchant-context';
import { logoutAction } from '@/server/actions/auth';
import { selectStoreAction } from '@/server/actions/merchant';
import { ServiceWorkerRegister } from '@/components/sw-register';

export const metadata: Metadata = {
  title: 'لوحة المحل',
  manifest: '/merchant.webmanifest',
  robots: { index: false },
  appleWebApp: { capable: true, title: 'المحل', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: '#172c22' };
export const dynamic = 'force-dynamic';

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const { auth, restaurants, restaurant, permissions } = await merchantContext('/merchant');
  if (!restaurant) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <p className="mb-4">الحساب ده مش مربوط بأي محل.</p>
        {auth.isPlatform && <Link className="btn btn-primary" href="/admin">Admin</Link>}
        <form action={logoutAction} className="mt-4"><button className="btn btn-secondary">تسجيل خروج</button></form>
      </main>
    );
  }
  const links = [
    { href: '/merchant', label: 'الطلبات', show: permissions.has('orders.view') || permissions.has('orders.delivery') },
    { href: '/merchant/dashboard', label: 'اليوم والتقارير', show: permissions.has('reports.view') },
    { href: '/merchant/menu', label: 'المنيو', show: permissions.has('menu.availability') || permissions.has('menu.manage') },
    { href: '/merchant/staff', label: 'الموظفين', show: permissions.has('staff.manage') },
  ];
  return (
    <div className="min-h-dvh">
      <nav aria-label="إدارة المطعم" className="merchant-nav flex items-center gap-1 overflow-x-auto px-4 text-sm text-white no-scrollbar">
        <span className="me-2 shrink-0 font-extrabold">{restaurant.nameAr}</span>
        {links.filter((l) => l.show).map((l) => (
          <Link key={l.href} href={l.href} className="shrink-0 rounded-lg px-3 py-1.5 hover:bg-white/10">{l.label}</Link>
        ))}
        <div className="ms-auto flex shrink-0 items-center gap-2">
          {restaurants.length > 1 && (
            <form action={selectStoreAction} className="flex items-center gap-1">
              <select name="restaurantId" defaultValue={restaurant.id} className="rounded-lg bg-white/10 px-2 py-1 text-xs">
                {restaurants.map((r) => <option key={r.id} value={r.id} className="text-black">{r.nameAr}</option>)}
              </select>
              <button className="rounded-lg bg-white/10 px-2 py-1 text-xs">تبديل</button>
            </form>
          )}
          {auth.isPlatform && <Link href="/admin" className="rounded-lg bg-indigo-500 px-2 py-1 text-xs">Admin</Link>}
          <span className="hidden text-xs text-gray-300 md:inline">{auth.user.name}</span>
          <form action={logoutAction}><button className="rounded-lg px-2 py-1 text-xs hover:bg-white/10">خروج</button></form>
        </div>
      </nav>
      {children}
      <ServiceWorkerRegister />
    </div>
  );
}
