'use client';

import { useId, useState } from 'react';
import { brandTextColor, DEFAULT_BRAND_COLOR } from '@/lib/domain/restaurant-brand';
import { useLanguage } from '@/components/language-provider';
import { localizedName } from '@/lib/i18n';

interface BrandFields {
  nameAr: string; nameEn: string; badgeText: string | null; badgeTextEn: string | null;
  taglineAr: string | null; taglineEn: string | null; brandColor: string;
  logoUrl: string | null; coverImageUrl: string | null;
}

export function RestaurantBrandEditor({ initial }: { initial?: Partial<BrandFields> }) {
  const prefix = useId();
  const { locale, t } = useLanguage();
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(initial?.nameEn ?? '');
  const [badgeText, setBadgeText] = useState(initial?.badgeText ?? '');
  const [badgeTextEn, setBadgeTextEn] = useState(initial?.badgeTextEn ?? '');
  const [taglineAr, setTaglineAr] = useState(initial?.taglineAr ?? '');
  const [taglineEn, setTaglineEn] = useState(initial?.taglineEn ?? '');
  const [brandColor, setBrandColor] = useState(initial?.brandColor ?? DEFAULT_BRAND_COLOR);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${prefix}-nameAr`}><span className="label">{t('اسم المطعم بالعربي', 'Restaurant name in Arabic')}</span><input id={`${prefix}-nameAr`} name="nameAr" value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={80} minLength={2} className="input" placeholder="الراية الدمشقية" dir="rtl" required /></label>
        <label htmlFor={`${prefix}-nameEn`}><span className="label">{t('اسم المطعم بالإنجليزي', 'Restaurant name in English')}</span><input id={`${prefix}-nameEn`} name="nameEn" value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={80} minLength={2} className="input" placeholder="Al Raya Al Dimashqia" dir="ltr" required /></label>
      </div>
      <details className="admin-details admin-form-section">
        <summary>{t('الشارة واللون والصور — اختياري', 'Badge, color & photos — optional')}</summary>
        <div className="grid gap-3 pt-3 sm:grid-cols-2">
          <label htmlFor={`${prefix}-badgeText`}><span className="label">{t('الشارة بالعربي', 'Badge in Arabic')}</span><input id={`${prefix}-badgeText`} name="badgeText" value={badgeText} onChange={(event) => setBadgeText(event.target.value)} maxLength={24} className="input" placeholder="الراية" dir="rtl" /><span className="mt-1 block text-[11px] text-gray-500">{t('تظهر على المنيو والملصق؛ حتى 24 حرفًا.', 'Shown on the menu and poster; up to 24 characters.')}</span></label>
          <label htmlFor={`${prefix}-badgeTextEn`}><span className="label">{t('الشارة بالإنجليزي', 'Badge in English')}</span><input id={`${prefix}-badgeTextEn`} name="badgeTextEn" value={badgeTextEn} onChange={(event) => setBadgeTextEn(event.target.value)} maxLength={24} className="input" dir="ltr" /></label>
          <label htmlFor={`${prefix}-brandColor`} className="sm:col-span-2"><span className="label">{t('لون المطعم', 'Brand color')}</span><div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2"><input id={`${prefix}-brandColor`} type="color" name="brandColor" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="h-8 w-12 cursor-pointer border-0 p-0" /><span className="font-mono text-sm text-gray-500" dir="ltr">{brandColor.toUpperCase()}</span></div></label>
          <label htmlFor={`${prefix}-taglineAr`}><span className="label">{t('جملة تعريفية بالعربي', 'Tagline in Arabic')}</span><input id={`${prefix}-taglineAr`} name="taglineAr" value={taglineAr} onChange={(event) => setTaglineAr(event.target.value)} maxLength={120} className="input" placeholder="من قلب الشام، لحد عندك" dir="rtl" /></label>
          <label htmlFor={`${prefix}-taglineEn`}><span className="label">{t('الجملة التعريفية بالإنجليزي', 'Tagline in English')}</span><input id={`${prefix}-taglineEn`} name="taglineEn" value={taglineEn} onChange={(event) => setTaglineEn(event.target.value)} maxLength={120} className="input" dir="ltr" /></label>
          <label htmlFor={`${prefix}-logoUrl`}><span className="label">{t('رابط صورة الشعار', 'Logo image link')}</span><input id={`${prefix}-logoUrl`} name="logoUrl" defaultValue={initial?.logoUrl ?? ''} className="input" placeholder="https://…" dir="ltr" /></label>
          <label htmlFor={`${prefix}-coverImageUrl`}><span className="label">{t('رابط صورة الغلاف', 'Cover image link')}</span><input id={`${prefix}-coverImageUrl`} name="coverImageUrl" defaultValue={initial?.coverImageUrl ?? ''} className="input" placeholder="https://…" dir="ltr" /></label>
        </div>
      </details>
      <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-[#fbfaf6] p-4" aria-label={t('معاينة هوية المطعم', 'Restaurant brand preview')}>
        <div className="grid min-h-16 min-w-16 max-w-24 place-items-center rounded-2xl px-3 text-center text-sm font-bold" style={{ backgroundColor: brandColor, color: brandTextColor(brandColor) }} dir="auto">{localizedName(locale, badgeText, badgeTextEn) || localizedName(locale, nameAr, nameEn).slice(0, 1) || t('ر', 'R')}</div>
        <div className="min-w-0 flex-1"><p className="break-words text-xl font-bold text-gray-900" dir="auto">{localizedName(locale, nameAr, nameEn) || t('اسم المطعم', 'Restaurant name')}</p>{localizedName(locale, taglineAr, taglineEn) && <p className="mt-2 text-sm text-gray-600" dir="auto">{localizedName(locale, taglineAr, taglineEn)}</p>}</div>
      </div>
    </div>
  );
}
