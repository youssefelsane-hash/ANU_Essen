import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { ArrowLeft, UtensilsCrossed, ScanLine, Clock3, ShoppingBag, AlarmClock } from 'lucide-react';
import { db } from '@/server/db';
import { restaurants } from '@/server/db/schema';
import { LanguageSwitcher } from '@/components/language-switcher';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { SiteFooter } from '@/components/site-footer';
import { getPlatformProfile } from '@/server/platform-profile';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ utm_source?: string | string[] }> }) {
  const locale = await getLocale('customer');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const [list, profile] = await Promise.all([
    db().select().from(restaurants).where(eq(restaurants.isActive, true)).orderBy(asc(restaurants.nameAr)),
    getPlatformProfile(),
  ]);
  const orderAhead = t(profile.orderAheadAr, profile.orderAheadEn);
  // Platform QR posters carry a label; pass it on so the restaurant's order keeps its source.
  const utm = (await searchParams).utm_source;
  const source = typeof utm === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(utm) ? utm : null;
  const storeHref = (slug: string) => `/s/${slug}${source ? `?utm_source=${encodeURIComponent(source)}` : ''}`;
  return <><main className="directory">
    <header className="directory-header">
      <Link href="/" className="flex items-center gap-3"><UtensilsCrossed size={24} strokeWidth={1.5} /><span className="text-lg font-semibold">{t(profile.nameAr, profile.nameEn)}</span></Link>
      <div className="flex flex-wrap items-center justify-end gap-4"><LanguageSwitcher /><Link href="/login" className="text-xs text-gray-500">{t('دخول فريق العمل', 'Staff sign in')} <ArrowLeft size={13} className="directional-arrow ms-2 inline" /></Link></div>
    </header>
    <section className="directory-title">
      <span className="text-xs tracking-widest text-stone-500">{t('أكل تحبه. انتظار أقل.', 'GOOD FOOD. LESS WAITING.')}</span>
      <h1>{t('وقتك غالي.', 'Your time matters.')}<br />{t('خلي أكلك يوصل لك.', 'Let your meal come to you.')}</h1>
      <p className="text-sm leading-7 text-stone-500">{t('اختار مطعمك، اعرف وقت الاستلام، وتابع طلبك من مكانك.', 'Choose your restaurant, see your pickup time, and track your order from wherever you are.')}</p>
      {orderAhead && <p className="order-ahead mt-6"><AlarmClock size={22} aria-hidden="true" />{orderAhead}</p>}
      <div id="how-it-works" className="mt-6 flex scroll-mt-6 flex-wrap gap-6 text-xs text-stone-500">
        <span className="flex items-center gap-2"><ScanLine size={16} />{t('افتح المنيو', 'Open the menu')}</span>
        <span className="flex items-center gap-2"><ShoppingBag size={16} />{t('اختار أكلك', 'Choose your meal')}</span>
        <span className="flex items-center gap-2"><Clock3 size={16} />{t('تابع وقت الاستلام', 'Track your pickup time')}</span>
      </div>
    </section>
    <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{t('المطاعم', 'Restaurants')}</h2><span className="text-xs text-stone-400">{list.length} {t('مطعم', 'restaurants')}</span></div>
    <div className="directory-grid">
      {list.map((r) => <Link key={r.id} href={storeHref(r.slug)} className="directory-store">
        <div className="directory-store-cover" style={{ backgroundColor: `${r.brandColor}18`, color: r.brandColor }}>
          {r.coverImageUrl ? <img src={r.coverImageUrl} alt="" /> : r.logoUrl ? <img src={r.logoUrl} alt="" style={{ width: '90px', height: '90px', objectFit: 'contain' }} /> : <span>{localizedName(locale, r.badgeText, r.badgeTextEn) || localizedName(locale, r.nameAr, r.nameEn).slice(0, 1)}</span>}
          <span className="absolute bottom-4 end-4 rounded-full bg-white/95 px-3 py-1 text-xs text-stone-700">{r.orderingStatus === 'OPEN' ? t('تصفح المنيو', 'Browse menu') : r.orderingStatus === 'PAUSED' ? t('الطلبات متوقفة مؤقتًا', 'Ordering paused') : t('مغلق حاليًا', 'Currently closed')}</span>
        </div>
        <div className="directory-store-info"><div><h2>{localizedName(locale, r.nameAr, r.nameEn)}</h2><p className="mt-1 text-xs text-stone-500">{localizedName(locale, r.taglineAr, r.taglineEn)}</p></div><span className="grid size-10 place-items-center rounded-full border border-stone-200"><ArrowLeft size={17} className="directional-arrow" /></span></div>
      </Link>)}
    </div>
    {list.length === 0 && <div className="card py-14 text-center"><UtensilsCrossed className="mx-auto mb-4 text-stone-400" /><p>{t('المطاعم هتظهر هنا قريبًا.', 'Restaurants will appear here soon.')}</p></div>}
  </main>
  <SiteFooter locale={locale} />
  </>;
}
