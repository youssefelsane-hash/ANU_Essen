import Link from 'next/link';
import { Mail } from 'lucide-react';
import { getPlatformProfile } from '@/server/platform-profile';
import { whatsappUrl } from '@/lib/domain/platform-profile';
import { text, type Locale } from '@/lib/i18n';

type Network = 'facebook' | 'instagram' | 'tiktok' | 'whatsapp';

/** Inline brand marks (no icon package for four static icons). */
const PATHS: Record<Network, string> = {
  facebook: 'M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06C2 17.08 5.66 21.24 10.44 22v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.44 2.91h-2.34V22C18.34 21.24 22 17.08 22 12.06z',
  instagram: 'M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zm0 3.18a6.66 6.66 0 100 13.32 6.66 6.66 0 000-13.32zm0 10.99a4.33 4.33 0 110-8.66 4.33 4.33 0 010 8.66zm8.47-11.25a1.56 1.56 0 11-3.11 0 1.56 1.56 0 013.11 0z',
  tiktok: 'M16.6 5.82A4.28 4.28 0 0115.54 3h-3.09v12.4a2.59 2.59 0 01-2.59 2.5 2.59 2.59 0 112.59-2.59v-3.1a5.68 5.68 0 105.68 5.68V9.4a7.34 7.34 0 004.28 1.37V7.68a4.28 4.28 0 01-1.81-.38 4.29 4.29 0 01-2-1.48z',
  whatsapp: 'M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.45 9.45 0 01-4.82-1.32l-.35-.21-3.58.94.96-3.49-.23-.36a9.43 9.43 0 01-1.45-5.03c0-5.21 4.24-9.45 9.46-9.45 2.53 0 4.9.99 6.69 2.78a9.39 9.39 0 012.77 6.69c0 5.22-4.24 9.45-9.44 9.45zm8.04-17.49A11.3 11.3 0 0012.05.67C5.79.67.69 5.76.69 12.03c0 2 .52 3.96 1.52 5.68L.6 23.33l5.75-1.51a11.33 11.33 0 005.43 1.38h.01c6.26 0 11.36-5.1 11.36-11.36 0-3.04-1.18-5.89-3.32-8.04z',
};
const COLORS: Record<Network, string> = { facebook: '#1877F2', instagram: '#E4405F', tiktok: '#111111', whatsapp: '#25D366' };

function BrandIcon({ network, size = 18 }: { network: Network; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill={COLORS[network]}><path d={PATHS[network]} /></svg>;
}

/**
 * Platform footer, three tiers: brand + contact (heaviest), navigation, then the light legal strip.
 * Every link points to a page that exists; contact links only render when the owner filled them in.
 */
export async function SiteFooter({ locale, className = '' }: { locale: Locale; className?: string }) {
  const p = await getPlatformProfile();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const name = t(p.nameAr, p.nameEn);
  const wa = whatsappUrl(p.whatsapp);
  const year = new Date().getFullYear();
  const socials = ([['facebook', p.facebookUrl, 'فيسبوك', 'Facebook'], ['instagram', p.instagramUrl, 'إنستجرام', 'Instagram'], ['tiktok', p.tiktokUrl, 'تيك توك', 'TikTok']] as const).filter(([, url]) => !!url);
  const joinHref = wa ? `${wa}?text=${encodeURIComponent(text(locale, `عايز أضيف مطعمي على ${p.nameAr}`, `I'd like to add my restaurant to ${p.nameEn}`))}` : p.email ? `mailto:${p.email}` : null;

  const columns: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
    {
      title: name,
      links: [
        { href: '/', label: t('كل المطاعم', 'All restaurants') },
        { href: '/my-orders', label: t('طلباتي', 'My orders') },
        { href: '/#how-it-works', label: t('إزاي تطلب', 'How it works') },
      ],
    },
    {
      title: t('للمطاعم', 'For restaurants'),
      links: [
        ...(joinHref ? [{ href: joinHref, label: t('ضيف مطعمك', 'Add your restaurant'), external: true }] : []),
        { href: '/login', label: t('دخول فريق المطعم', 'Restaurant team sign in') },
      ],
    },
    {
      title: t('المساعدة', 'Help'),
      links: [
        { href: '/support', label: t('الدعم والشكاوى', 'Support & complaints') },
        ...(wa ? [{ href: wa, label: t('واتساب', 'WhatsApp'), external: true }] : []),
        { href: '/legal/refunds', label: t('الإلغاء والاسترجاع', 'Cancellations & refunds') },
      ],
    },
  ];
  const legal = [
    { href: '/legal/terms', label: t('شروط الاستخدام', 'Terms of use') },
    { href: '/legal/privacy', label: t('سياسة الخصوصية', 'Privacy policy') },
    { href: '/legal/refunds', label: t('سياسة الاسترجاع', 'Refund policy') },
  ];

  return (
    <footer className={`site-footer mt-16 border-t border-stone-200 bg-white text-stone-700 ${className}`}>
      <div className="mx-auto w-full max-w-6xl px-4">
        <div className="grid gap-10 py-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="text-2xl font-bold text-stone-900">{name}</p>
            {t(p.descriptionAr, p.descriptionEn) && <p className="mt-3 max-w-sm text-sm leading-7 text-stone-600">{t(p.descriptionAr, p.descriptionEn)}</p>}
            {socials.length > 0 && (
              <ul className="mt-5 flex flex-wrap items-center gap-2.5">
                {socials.map(([network, url, ar, en]) => (
                  <li key={network}>
                    <a href={url!} target="_blank" rel="noopener noreferrer" aria-label={t(ar, en)} title={t(ar, en)} className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-stone-50 transition hover:border-stone-400">
                      <BrandIcon network={network} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {(wa || p.email) && (
              <ul className="mt-5 space-y-2 text-sm">
                {wa && <li><a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-stone-950"><BrandIcon network="whatsapp" size={16} /><span dir="ltr">{p.whatsapp}</span></a></li>}
                {p.email && <li><a href={`mailto:${p.email}`} className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-950"><Mail size={15} aria-hidden="true" /><span dir="ltr">{p.email}</span></a></li>}
              </ul>
            )}
          </div>
          <nav className="grid gap-8 sm:grid-cols-3 lg:col-span-8" aria-label={t('روابط المنصة', 'Site links')}>
            {columns.map((column) => (
              <div key={column.title}>
                <h2 className="text-xs font-semibold text-stone-500">{column.title}</h2>
                <ul className="mt-4 space-y-3 text-sm">
                  {column.links.map((link) => (
                    <li key={link.href + link.label}>
                      {link.external
                        ? <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-stone-800 hover:text-stone-950 hover:underline">{link.label}</a>
                        : <Link href={link.href} className="text-stone-800 hover:text-stone-950 hover:underline">{link.label}</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="border-t border-stone-200 py-7 text-xs leading-6 text-stone-600">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p><span dir="ltr">© {year} {p.companyEn}</span> — {t('جميع الحقوق محفوظة.', 'All rights reserved.')}</p>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {legal.map((link) => <li key={link.href}><Link href={link.href} className="hover:text-stone-950 hover:underline">{link.label}</Link></li>)}
            </ul>
          </div>
          <div className="mt-4 space-y-1">
            <p>{p.nameAr} (<span dir="ltr">{p.nameEn}</span>) — {t('تُدار بواسطة', 'operated by')} {locale === 'ar' ? p.companyAr : ''}{locale === 'ar' ? ' — ' : ''}<span dir="ltr">{p.companyEn}</span></p>
            {p.addressAr && <p>{p.addressAr}</p>}
            {(p.commercialRegister || p.taxId) && (
              <p>
                {p.commercialRegister && <>{t('السجل التجاري', 'Commercial register')}: <span dir="ltr">{p.commercialRegister}</span></>}
                {p.commercialRegister && p.taxId && <span className="mx-2">·</span>}
                {p.taxId && <>{t('الرقم الضريبي', 'Tax ID')}: <span dir="ltr">{p.taxId}</span></>}
              </p>
            )}
            <p>{t(`${p.nameAr} وشعارها وتصميم ومحتوى المنصة مملوكة لـ ${p.companyAr}`, `${p.nameEn}, its logo, design and content are owned by ${p.companyEn}`)}{locale === 'ar' ? <> — <span dir="ltr">{p.companyEn}</span></> : null}. {t('كل مطعم مسؤول عن أكله وأسعاره والفلوس اللي بيستلمها.', 'Each restaurant is responsible for its food, prices and the payments it receives.')}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
