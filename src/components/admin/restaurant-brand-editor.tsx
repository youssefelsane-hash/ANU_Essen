'use client';

import { useId, useState } from 'react';
import { brandTextColor, DEFAULT_BRAND_COLOR } from '@/lib/domain/restaurant-brand';

interface BrandFields {
  nameAr: string;
  nameEn: string;
  badgeText: string | null;
  taglineAr: string | null;
  brandColor: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
}

/** Each input belongs to the surrounding platform-only restaurant form. */
export function RestaurantBrandEditor({ initial }: { initial?: Partial<BrandFields> }) {
  const prefix = useId();
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(initial?.nameEn ?? '');
  const [badgeText, setBadgeText] = useState(initial?.badgeText ?? '');
  const [taglineAr, setTaglineAr] = useState(initial?.taglineAr ?? '');
  const [brandColor, setBrandColor] = useState(initial?.brandColor ?? DEFAULT_BRAND_COLOR);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${prefix}-nameAr`}><span className="label">Restaurant name · Arabic</span><input id={`${prefix}-nameAr`} name="nameAr" value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={80} minLength={2} className="input" placeholder="الراية الدمشقية" dir="rtl" required /></label>
        <label htmlFor={`${prefix}-nameEn`}><span className="label">Restaurant name · English</span><input id={`${prefix}-nameEn`} name="nameEn" value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={80} minLength={2} className="input" placeholder="Al Raya Al Dimashqia" required /></label>
        <label htmlFor={`${prefix}-badgeText`}><span className="label">Badge / short brand label</span><input id={`${prefix}-badgeText`} name="badgeText" value={badgeText} onChange={(event) => setBadgeText(event.target.value)} maxLength={24} className="input" placeholder="الراية" dir="auto" /><span className="mt-1 block text-[11px] text-gray-500">Shown on the menu and QR poster. Up to 24 characters.</span></label>
        <label htmlFor={`${prefix}-brandColor`}><span className="label">Brand color</span><div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2"><input id={`${prefix}-brandColor`} type="color" name="brandColor" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="h-8 w-12 cursor-pointer border-0 p-0" /><span className="font-mono text-sm text-gray-500">{brandColor.toUpperCase()}</span></div></label>
        <label htmlFor={`${prefix}-taglineAr`} className="sm:col-span-2"><span className="label">Brand tagline · Arabic</span><input id={`${prefix}-taglineAr`} name="taglineAr" value={taglineAr} onChange={(event) => setTaglineAr(event.target.value)} maxLength={120} className="input" placeholder="من قلب الشام، لحد عندك" dir="rtl" /></label>
        <label htmlFor={`${prefix}-logoUrl`}><span className="label">Logo image URL</span><input id={`${prefix}-logoUrl`} name="logoUrl" defaultValue={initial?.logoUrl ?? ''} className="input" placeholder="https://… or /images/logo.webp" dir="ltr" /></label>
        <label htmlFor={`${prefix}-coverImageUrl`}><span className="label">Restaurant cover image URL</span><input id={`${prefix}-coverImageUrl`} name="coverImageUrl" defaultValue={initial?.coverImageUrl ?? ''} className="input" placeholder="https://… or /images/cover.webp" dir="ltr" /></label>
      </div>
      <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-[#fbfaf6] p-4" aria-label="Brand preview">
        <div className="grid min-h-16 min-w-16 max-w-24 place-items-center rounded-2xl px-3 text-center text-sm font-bold" style={{ backgroundColor: brandColor, color: brandTextColor(brandColor) }} dir="auto">{badgeText || nameAr.slice(0, 1) || 'ر'}</div>
        <div className="min-w-0 flex-1 text-right" dir="rtl"><p className="break-words text-xl font-bold text-gray-900">{nameAr || 'اسم المطعم'}</p><p className="mt-1 text-xs text-gray-500" dir="ltr">{nameEn || 'Restaurant name'}</p>{taglineAr && <p className="mt-2 text-sm text-gray-600">{taglineAr}</p>}</div>
      </div>
    </div>
  );
}
