import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { pageAuth } from '@/server/auth/session';
import { logoutAction } from '@/server/actions/auth';
import { UtensilsCrossed, LogOut, ExternalLink } from 'lucide-react';
import { AdminNavigation } from '@/components/admin/navigation';

export const metadata: Metadata = { title: 'Platform Admin', robots: { index: false } };
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: 'Overview', permission: 'platform.finance', icon: 'LayoutDashboard' },
  { href: '/admin/restaurants', label: 'Restaurants & branding', permission: 'platform.restaurants', icon: 'Store' },
  { href: '/admin/orders', label: 'Orders', permission: 'platform.restaurants', icon: 'ReceiptText' },
  { href: '/admin/finance', label: 'Finance & settlements', permission: 'platform.finance', icon: 'Wallet' },
  { href: '/admin/customers', label: 'Customers', permission: 'platform.restaurants', icon: 'Users' },
  { href: '/admin/users', label: 'Team members', permission: 'platform.users', icon: 'UserCog' },
  { href: '/admin/roles', label: 'Roles & permissions', permission: 'platform.users', icon: 'ShieldCheck' },
  { href: '/admin/audit', label: 'Activity log', permission: 'platform.audit', icon: 'ScrollText' },
  { href: '/admin/settings', label: 'System settings', permission: 'platform.settings', icon: 'Settings' },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await pageAuth('/admin');
  if (!auth.isPlatform) redirect('/merchant');
  return (
    <div dir="ltr" lang="en" className="admin-shell min-h-dvh md:flex">
      <aside className="admin-sidebar text-gray-100 md:sticky md:top-0 md:flex md:h-dvh md:shrink-0 md:flex-col">
        <div className="admin-brand">
          <div className="admin-brand-mark"><UtensilsCrossed size={22} strokeWidth={1.5} /></div>
          <div><strong>Restaurant platform</strong><small>THE CONTROL ROOM</small></div>
        </div>
        <div className="admin-user">{auth.user.name}<div className="mt-1 opacity-60">{auth.user.email}</div></div>
        <div className="admin-nav-label">WORKSPACE</div>
        <nav aria-label="Platform navigation" className="no-scrollbar flex overflow-x-auto px-2 pb-3 md:block md:overflow-y-auto md:px-0">
          <AdminNavigation items={NAV.filter(({ permission }) => auth.platformPermissions.has(permission)).map(({ href, label, icon }) => ({ href, label, icon }))} />
        </nav>
        <div className="admin-bottom flex md:block">
          <Link href="/merchant" className="admin-link"><ExternalLink size={17} strokeWidth={1.6} />Kitchen screen</Link>
          <form action={logoutAction}><button className="admin-link w-auto"><LogOut size={17} strokeWidth={1.6} />Sign out</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8 lg:px-10">
        <div className="admin-content"><div className="admin-topline"><span>RESTAURANT OPERATIONS</span><Link href="/" className="flex items-center gap-2">Open customer experience <ExternalLink size={13} /></Link></div>{children}</div>
      </main>
    </div>
  );
}
