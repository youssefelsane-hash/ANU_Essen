'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { localizeMessage, localizedName } from '@/lib/i18n';
import { brandTextColor } from '@/lib/domain/restaurant-brand';
import { buildPlatformQrUrl, buildRestaurantQrUrl, isLocalQrOrigin, RESTAURANT_QR_OPTIONS } from '@/lib/domain/restaurant-qr';

interface QrRestaurant {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  badgeText: string | null;
  badgeTextEn?: string | null;
  brandColor: string;
}

function download(href: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (href.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(href), 5000);
}

/** The platform itself, as a QR "restaurant": its code opens the list of every restaurant. */
export interface QrPlatform { nameAr: string; nameEn: string }

const PLATFORM_COLOR = '#234d3b';

/** Black-on-white QR with a four-module quiet zone, plus a separate branded poster. */
export function QrGenerator({ restaurant: forRestaurant, platform, baseUrl }: { restaurant?: QrRestaurant; platform?: QrPlatform; baseUrl: string | null }) {
  const { locale, t } = useLanguage();
  const isPlatform = !forRestaurant;
  const restaurant: QrRestaurant = forRestaurant ?? { id: '', slug: 'platform', nameAr: platform?.nameAr ?? '', nameEn: platform?.nameEn ?? '', badgeText: 'كل المطاعم في مكان واحد', badgeTextEn: 'Every restaurant in one place', brandColor: PLATFORM_COLOR };
  const primaryName = localizedName(locale, restaurant.nameAr, restaurant.nameEn);
  const badge = localizedName(locale, restaurant.badgeText, restaurant.badgeTextEn);
  const posterFont = locale === 'ar' ? 'IBM Plex Sans Arabic' : 'Manrope';
  const subline = isPlatform ? t('كل مطاعم الجامعة في موبايلك', 'Every campus restaurant on your phone') : t('المنيو والطلب في موبايلك', 'The menu and ordering on your phone');
  const [source, setSource] = useState(isPlatform ? 'platform_poster_1' : 'campus_poster_1');
  const [origin, setOrigin] = useState(baseUrl ?? '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    if (!baseUrl) setOrigin(window.location.origin);
  }, [baseUrl]);
  const target = useMemo(() => {
    try {
      return { url: isPlatform ? buildPlatformQrUrl(origin, source) : buildRestaurantQrUrl(origin, restaurant.id, source), error: '' };
    } catch (failure) {
      return { url: '', error: (failure as Error).message };
    }
  }, [origin, restaurant.id, source, isPlatform]);

  useEffect(() => {
    let cancelled = false;
    setSvg('');
    setError('');
    setFeedback('');
    if (target.url) {
      import('qrcode').then((QR) => QR.toString(target.url, { ...RESTAURANT_QR_OPTIONS, type: 'svg' }))
        .then((result) => { if (!cancelled) setSvg(result); })
        .catch(() => { if (!cancelled) setError(t('لم نتمكن من إنشاء الرمز. حاول مرة أخرى.', 'Could not generate the QR. Try again.'));  });
    }
    return () => { cancelled = true; };
  }, [target.url, locale]);

  const exportPng = async (poster: boolean) => {
    if (!target.url || !svg) return;
    setDownloading(true);
    setError('');
    try {
      const QR = await import('qrcode');
      const qr = await QR.toDataURL(target.url, { ...RESTAURANT_QR_OPTIONS, width: 1000 });
      const filename = `${restaurant.slug}-${source || 'direct'}-${locale}`;
      if (!poster) {
        download(qr, `qr-${filename}.png`);
        return;
      }
      await document.fonts.ready;
      await Promise.all([
        document.fonts.load('700 64px "IBM Plex Sans Arabic"', restaurant.nameAr),
        document.fonts.load('400 30px "IBM Plex Sans Arabic"', 'المنيو والطلب في موبايلك'),
        document.fonts.load('500 32px "Manrope"', restaurant.nameEn),
        document.fonts.load('700 64px "Manrope"', restaurant.nameEn),
      ]);
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1680;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = restaurant.brandColor;
      ctx.fillRect(0, 0, canvas.width, 340);
      ctx.textAlign = 'center';
      ctx.direction = locale === 'ar' ? 'rtl' : 'ltr';
      ctx.fillStyle = brandTextColor(restaurant.brandColor);
      ctx.textBaseline = 'middle';
      if (badge) {
        ctx.font = `700 26px "${posterFont}", sans-serif`;
        ctx.fillText(badge, 600, 44, 1060);
      }
      let titleLines: string[] = [];
      let fontSize = 68;
      const maxTitleWidth = 1020;
      const titleArea = { top: 84, height: 148 };
      do {
        fontSize -= 4;
        ctx.font = `700 ${fontSize}px "${posterFont}", sans-serif`;
        titleLines = [];
        let line = '';
        for (const word of primaryName.trim().split(/\s+/)) {
          const next = `${line} ${word}`.trim();
          if (ctx.measureText(next).width <= maxTitleWidth) { line = next; continue; }
          if (line) { titleLines.push(line); line = ''; }
          if (ctx.measureText(word).width <= maxTitleWidth) { line = word; continue; }
          // A restaurant name can contain one long unbroken word. Wrap graphemes
          // rather than allowing a third line to overlap the English name.
          for (const { segment } of new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(word)) {
            if (line && ctx.measureText(line + segment).width > maxTitleWidth) { titleLines.push(line); line = ''; }
            line += segment;
          }
        }
        if (line) titleLines.push(line);
      } while ((titleLines.length > 2 || titleLines.length * fontSize * 1.25 > titleArea.height) && fontSize > 20);
      const visibleTitle = titleLines.slice(0, 2);
      const lineHeight = fontSize * 1.25;
      const firstLineCenter = titleArea.top + (titleArea.height - (visibleTitle.length - 1) * lineHeight) / 2;
      visibleTitle.forEach((text, i) => ctx.fillText(text, 600, firstLineCenter + i * lineHeight, maxTitleWidth));
      ctx.font = '500 32px "Manrope", sans-serif';
      ctx.direction = 'ltr';
      ctx.font = `500 32px "${locale === 'ar' ? 'Manrope' : 'IBM Plex Sans Arabic'}", sans-serif`;
      ctx.direction = locale === 'ar' ? 'ltr' : 'rtl';
      ctx.fillText(locale === 'ar' ? restaurant.nameEn : restaurant.nameAr, 600, 292, 1060);
      ctx.textBaseline = 'alphabetic';
      const img = new Image();
      img.src = qr;
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('QR image unavailable')); });
      ctx.drawImage(img, 100, 395, 1000, 1000);
      ctx.direction = locale === 'ar' ? 'rtl' : 'ltr';
      ctx.fillStyle = '#182b25';
      ctx.font = `700 56px "${posterFont}", sans-serif`;
      ctx.fillText(t('امسح. اطلب. واستلم.', 'Scan. Order. Pick up.'), 600, 1480);
      ctx.fillStyle = '#64746b';
      ctx.font = `400 30px "${posterFont}", sans-serif`;
      ctx.fillText(subline, 600, 1540);
      ctx.direction = 'ltr';
      ctx.font = '500 24px "Manrope", sans-serif';
      ctx.fillText(`${new URL(target.url).host} / ${source || 'direct'}`, 600, 1620, 1080);
      download(canvas.toDataURL('image/png'), `poster-${filename}.png`);
      setFeedback(t('تم تنزيل الملصق. جرّب مسحه بالموبايل قبل الطباعة.', 'Poster downloaded. Scan it on a phone before printing.'));
    } catch {
      setError(t('تعذر التنزيل. حاول مرة أخرى.', 'Download failed. Please try again.'));
    } finally {
      setDownloading(false);
    }
  };

  const canDownload = !!svg && !!target.url && !downloading;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">{isPlatform ? t('رمز المنصة بيفتح صفحة كل المطاعم. حطه في الأماكن العامة (المدخل، الكافتيريا، المدرجات)، والطالب يختار المطعم بنفسه.', 'The platform QR opens the page listing every restaurant. Put it in shared spaces (entrance, cafeteria, lecture halls) and students choose the restaurant.') : t('لكل مطعم رمز طلب ثابت. يظل المطبوع يعمل بعد تغيير اسم المطعم أو رابط المنيو.', 'One permanent QR per restaurant. Printed codes keep working when you change its name or menu slug.')}</p>
        <label className="block"><span className="label">{t('رابط الموقع المنشور', 'Public website address')}</span><input className="input" value={origin} onChange={(event) => setOrigin(event.target.value)} dir="ltr" placeholder="https://your-domain.com" autoComplete="url" /></label>
        <label className="block"><span className="label">{t('اسم الملصق — مثل gate_1 أو table_04', 'Poster label (for example, gate_1 or table_04)')}</span><input className="input" value={source} maxLength={64} onChange={(event) => setSource(event.target.value)} dir="ltr" /></label>
        {target.url && <p className="break-all rounded-xl bg-gray-50 p-3 font-mono text-xs" dir="ltr">{target.url}</p>}
        {target.url && isLocalQrOrigin(origin) && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="status">{t('هذا رابط تجربة محلية. أضف رابط الموقع المنشور قبل الطباعة ليعمل على موبايلات العملاء.', "This is a local test address. Enter the published HTTPS website address before printing: customers' phones cannot open localhost.")}</p>}
        {(target.error || error) && <p className="text-sm text-red-600" role="alert">{locale === 'ar' && target.error ? (target.error.startsWith('Poster') ? 'اسم الملصق: استخدم حتى 64 حرفًا إنجليزيًا أو رقمًا أو شرطة.' : target.error.startsWith('Invalid restaurant') ? 'المطعم غير موجود.' : 'اكتب رابط الموقع فقط مثل https://your-domain.com، دون مسار إضافي.') : localizeMessage(target.error || error, locale)}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={!canDownload} onClick={() => void exportPng(true)}>{downloading ? t('جاري التجهيز…', 'Preparing…') : isPlatform ? t('تنزيل ملصق المنصة', 'Download platform poster') : t('تنزيل ملصق المطعم', 'Download branded poster')}</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!canDownload} onClick={() => void exportPng(false)}>{t('صورة الرمز PNG', 'QR PNG')}</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!canDownload} onClick={() => download(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), `qr-${restaurant.slug}-${source || 'direct'}.svg`)}>{t('الرمز SVG', 'QR SVG')}</button>
        </div>
        {target.url && <div className="flex flex-wrap items-center gap-4 text-sm">
          <button type="button" className="font-semibold text-emerald-700" onClick={async () => { try { await navigator.clipboard.writeText(target.url); setFeedback(t('تم نسخ الرابط', 'QR link copied')); } catch { setError(t('تعذر النسخ. حدد الرابط بالأعلى وانسخه.', 'Could not copy. Select and copy the link above.')); } }}>{t('نسخ الرابط', 'Copy link')}</button>
          <a href={target.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700">{isPlatform ? t('فتح الصفحة وتجربتها ↗', 'Open and check page ↗') : t('فتح المنيو وتجربته ↗', 'Open and check menu ↗')}</a>
        </div>}
        {feedback && <p className="text-sm text-emerald-700" role="status">{feedback}</p>}
        <p className="text-xs leading-relaxed text-gray-500">{t('اترك الإطار الأبيض حول الرمز. اطبع الملصق بعرض 3 سم على الأقل، وجرّب النسخة المطبوعة بالموبايل.', 'Keep the white border around the QR. For a table sticker, print it at least 3 cm wide and test the final print on a phone.')}</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white text-center shadow-sm" aria-label={`${t('ملصق طلب', 'QR poster for')} ${primaryName}`}>
        <div className="space-y-2 px-4 py-7" style={{ backgroundColor: restaurant.brandColor, color: brandTextColor(restaurant.brandColor) }}>
          {badge && <span className="inline-block rounded-full border border-current/30 px-3 py-1 text-[11px]" dir="rtl">{badge}</span>}
          <p className="text-xl font-bold" dir="auto">{primaryName}</p>
          <p className="text-[10px] opacity-80">{locale === 'ar' ? restaurant.nameEn : restaurant.nameAr}</p>
        </div>
        <div className="p-4">{svg ? <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt={`${t('امسح لطلب الطعام من', 'Scan to order from')} ${primaryName}`} className="aspect-square w-full" /> : <div className="skeleton aspect-square" />}</div>
        <div className="px-4 pb-6"><p className="font-bold text-gray-900">{t('امسح. اطلب. واستلم.', 'Scan. Order. Pick up.')}</p><p className="mt-1 text-xs text-gray-500">{subline}</p></div>
      </div>
    </div>
  );
}
