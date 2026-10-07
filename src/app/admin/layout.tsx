import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { pageAuth } from '@/server/auth/session';
import { logoutAction } from '@/server/actions/auth';

export const metadata: Metadata = { title: 'Platform Admin', robots: { index: false } };
export const dynamic = 'force-dynamic';

const NAV: [string, string, string][] = [
  ['/admin', 'Overview', 'platform.finance'],
  ['/admin/restaurants', 'Restaurants', 'platform.restaurants'],
  ['/admin/orders', 'Orders', 'platform.restaurants'],
  ['/admin/finance', 'Commissions & settlements', 'platform.finance'],
  ['/admin/customers', 'Customers', 'platform.restaurants'],
  ['/admin/users', 'Users & staff', 'platform.users'],
  ['/admin/roles', 'Roles & permissions', 'platform.users'],
  ['/admin/audit', 'Audit log', 'platform.audit'],
  ['/admin/settings', 'System settings', 'platform.settings'],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await pageAuth('/admin');
  if (!auth.isPlatform) redirect('/merchant');
  return (
    <div dir="ltr" lang="en" className="min-h-dvh md:flex">
      <aside className="bg-gray-900 text-gray-100 md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div className="text-lg font-black">Platform Admin</div>
          <div className="text-xs text-gray-400">{auth.user.email}</div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-2 pb-2 md:block md:space-y-0.5 md:overflow-visible">
          {NAV.filter(([, , perm]) => auth.platformPermissions.has(perm)).map(([href, label]) => (
            <Link key={href} href={href} className="block shrink-0 rounded-lg px-3 py-2 text-sm hover:bg-white/10">{label}</Link>
          ))}
          <Link href="/merchant" className="block shrink-0 rounded-lg px-3 py-2 text-sm text-orange-300 hover:bg-white/10">Merchant screen →</Link>
          <form action={logoutAction}>
            <button className="block w-full shrink-0 rounded-lg px-3 py-2 text-start text-sm text-gray-400 hover:bg-white/10">Sign out</button>
          </form>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
