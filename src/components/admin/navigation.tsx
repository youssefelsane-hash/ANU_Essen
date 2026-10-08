'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Store, ReceiptText, Wallet, Users, UserCog, ShieldCheck, ScrollText, Settings, ChefHat, ChevronDown, RotateCcw, QrCode, Bike } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';

const icons = { LayoutDashboard, Store, ReceiptText, Wallet, Users, UserCog, ShieldCheck, ScrollText, Settings, ChefHat, RotateCcw, QrCode, Bike };
type Item = { href: string; ar: string; en: string; icon: keyof typeof icons; primary: boolean };
export function AdminNavigation({ items }: { items: Item[] }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const render = ({ href, ar, en, icon }: Item) => {
    const Icon = icons[icon];
    const active = href === '/admin' ? pathname === href : pathname.startsWith(href);
    return <Link href={href} key={href} className="admin-link" aria-current={active ? 'page' : undefined}><Icon size={19} strokeWidth={1.6} aria-hidden="true" /><span>{t(ar, en)}</span></Link>;
  };
  const advanced = items.filter((item) => !item.primary);
  return <>
    <div className="admin-primary-nav">{items.filter((item) => item.primary).map(render)}</div>
    {advanced.length > 0 && <details className="admin-advanced-nav" open={advanced.some((item) => pathname.startsWith(item.href)) || undefined}>
      <summary><Settings size={17} aria-hidden="true" /><span>{t('الفريق والإعدادات', 'Team & settings')}</span><ChevronDown size={14} aria-hidden="true" /></summary>
      {advanced.map(render)}
    </details>}
  </>;
}
