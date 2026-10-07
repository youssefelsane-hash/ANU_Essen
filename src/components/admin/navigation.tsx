'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Store, ReceiptText, Wallet, Users, UserCog, ShieldCheck, ScrollText, Settings, ChefHat } from 'lucide-react';

const icons = { LayoutDashboard, Store, ReceiptText, Wallet, Users, UserCog, ShieldCheck, ScrollText, Settings, ChefHat };

export function AdminNavigation({ items }: { items: { href: string; label: string; icon: keyof typeof icons }[] }) {
  const pathname = usePathname();
  return <>{items.map(({ href, label, icon }) => {
    const Icon = icons[icon];
    const active = href === '/admin' ? pathname === href : pathname.startsWith(href);
    return <Link href={href} key={href} className="admin-link" aria-current={active ? 'page' : undefined}><Icon size={17} strokeWidth={1.6} /><span>{label}</span></Link>;
  })}</>;
}
