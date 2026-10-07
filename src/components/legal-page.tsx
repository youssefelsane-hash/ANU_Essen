import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { SiteFooter } from '@/components/site-footer';
import { getPlatformProfile } from '@/server/platform-profile';
import { whatsappUrl, type PlatformProfile } from '@/lib/domain/platform-profile';
import { text, type Locale } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

export interface LegalSection { title: [string, string]; body: [string, string][] }

/** Shared shell for the policy pages: platform header, numbered sections, contact block, footer. */
export async function LegalPage({ title, intro, sections }: { title: [string, string]; intro: (p: PlatformProfile) => [string, string]; sections: (p: PlatformProfile) => LegalSection[] }) {
  const locale: Locale = await getLocale('customer');
  const p = await getPlatformProfile();
  const t = (pair: [string, string]) => text(locale, ...pair);
  const wa = whatsappUrl(p.whatsapp);
  return (
    <>
      <main className="directory">
        <header className="directory-header">
          <Link href="/" className="flex items-center gap-3"><UtensilsCrossed size={24} strokeWidth={1.5} /><span className="text-lg font-semibold">{text(locale, p.nameAr, p.nameEn)}</span></Link>
          <LanguageSwitcher />
        </header>
        <article className="mx-auto max-w-3xl py-10">
          <h1 className="text-3xl font-bold">{t(title)}</h1>
          <p className="mt-3 leading-8 text-stone-600">{t(intro(p))}</p>
          <ol className="mt-8 space-y-7">
            {sections(p).map((s, i) => (
              <li key={i} id={`section-${i + 1}`} className="scroll-mt-6">
                <h2 className="text-lg font-semibold">{i + 1}. {t(s.title)}</h2>
                {s.body.map((para, j) => <p key={j} className="mt-2 leading-8 text-stone-700">{t(para)}</p>)}
              </li>
            ))}
          </ol>
          {(wa || p.email) && (
            <div className="mt-10 rounded-2xl border border-stone-200 bg-white p-5 text-sm">
              <p className="font-semibold">{text(locale, 'محتاج مساعدة؟', 'Need help?')}</p>
              <div className="mt-2 flex flex-wrap gap-4">
                {wa && <a className="text-emerald-800 underline" href={wa} target="_blank" rel="noopener noreferrer">{text(locale, 'كلّمنا على واتساب', 'Message us on WhatsApp')}</a>}
                {p.email && <a className="text-emerald-800 underline" href={`mailto:${p.email}`} dir="ltr">{p.email}</a>}
              </div>
            </div>
          )}
        </article>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
