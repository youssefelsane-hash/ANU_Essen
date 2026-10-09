import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { SiteFooter } from '@/components/site-footer';
import { getPlatformProfile } from '@/server/platform-profile';
import { text, type Locale } from '@/lib/i18n';

/** Header + footer around simple customer pages (policies, my orders, support). */
export async function CustomerShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const p = await getPlatformProfile();
  return (
    <>
      <main className="directory">
        <header className="directory-header">
          <Link href="/" className="flex items-center gap-3"><UtensilsCrossed size={24} strokeWidth={1.5} /><span className="text-lg font-semibold">{text(locale, p.nameAr, p.nameEn)}</span></Link>
          <LanguageSwitcher />
        </header>
        {children}
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
