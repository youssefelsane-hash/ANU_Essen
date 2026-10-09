'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { Check, ExternalLink, Palette, Save } from 'lucide-react';
import { ImageField } from '@/components/menu/image-field';
import { useLanguage } from '@/components/language-provider';
import { brandTextColor, type RestaurantBrand } from '@/lib/domain/restaurant-brand';
import { initialActionState } from '@/lib/action-state';
import { localizedName, localizeMessage } from '@/lib/i18n';
import { updateMerchantBrandAction } from '@/server/actions/merchant-brand';

const COLORS = ['#163d35', '#243a63', '#77372d', '#7b5324', '#532d66', '#242424'];

export function AppearanceEditor({ restaurant }: { restaurant: RestaurantBrand & { id: string; slug: string } }) {
  const { locale, t } = useLanguage();
  const prefix = useId();
  const [state, formAction, pending] = useActionState(updateMerchantBrandAction, initialActionState);
  const [uploading, setUploading] = useState(false);
  const [nameAr, setNameAr] = useState(restaurant.nameAr);
  const [nameEn, setNameEn] = useState(restaurant.nameEn);
  const [badgeAr, setBadgeAr] = useState(restaurant.badgeText ?? '');
  const [badgeEn, setBadgeEn] = useState(restaurant.badgeTextEn ?? '');
  const [taglineAr, setTaglineAr] = useState(restaurant.taglineAr ?? '');
  const [taglineEn, setTaglineEn] = useState(restaurant.taglineEn ?? '');
  const [color, setColor] = useState(restaurant.brandColor);
  const [logo, setLogo] = useState(restaurant.logoUrl ?? '');
  const [cover, setCover] = useState(restaurant.coverImageUrl ?? '');
  const busy = pending || uploading;
  return <main className="mx-auto w-full max-w-4xl space-y-5 p-4 pb-28 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-black"><Palette size={25} />{t('اسم وشكل المطعم', 'Restaurant appearance')}</h1><p className="mt-2 text-sm text-gray-600">{t('غيّر الاسم والصور واللون. المعاينة تحت بتتحدث مع اختياراتك.', 'Change the name, photos and color. The preview updates as you go.')}</p></div><Link className="btn btn-secondary" href={`/s/${restaurant.slug}`}><ExternalLink size={17} />{t('شوف المنيو', 'View menu')}</Link></header>
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="restaurantId" value={restaurant.id} />
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <section className="card space-y-4"><h2 className="text-lg font-bold">{t('اسم المطعم', 'Restaurant name')}</h2><div className="grid gap-4 sm:grid-cols-2"><label htmlFor={`${prefix}-ar`}><span className="label">{t('بالعربي', 'Arabic')}</span><input id={`${prefix}-ar`} name="nameAr" className="input" dir="rtl" required minLength={2} maxLength={80} value={nameAr} onChange={(event) => setNameAr(event.target.value)} autoComplete="organization" /></label><label htmlFor={`${prefix}-en`}><span className="label">{t('بالإنجليزي', 'English')}</span><input id={`${prefix}-en`} name="nameEn" className="input" dir="ltr" required minLength={2} maxLength={80} value={nameEn} onChange={(event) => setNameEn(event.target.value)} autoComplete="organization" /></label></div></section>
        <section className="card space-y-4"><h2 className="text-lg font-bold">{t('صور المطعم', 'Restaurant photos')}</h2><p className="text-sm text-gray-600">{t('اختار صورة من الموبايل أو الكمبيوتر؛ بنصغّرها تلقائيًا علشان المنيو يفتح بسرعة.', 'Choose a photo from your phone or computer. We resize it automatically to keep the menu fast.')}</p><div className="grid gap-5 sm:grid-cols-2"><ImageField name="logoUrl" restaurantId={restaurant.id} scope="profile" initial={restaurant.logoUrl ?? null} label={t('الشعار', 'Logo')} onBusyChange={setUploading} onChange={setLogo} /><ImageField name="coverImageUrl" restaurantId={restaurant.id} scope="profile" initial={restaurant.coverImageUrl ?? null} label={t('صورة الغلاف', 'Cover photo')} onBusyChange={setUploading} onChange={setCover} /></div></section>
        <section className="card space-y-4"><h2 className="text-lg font-bold">{t('لون المطعم', 'Brand color')}</h2><div className="flex flex-wrap gap-3" role="group" aria-label={t('ألوان جاهزة', 'Suggested colors')}>{COLORS.map((choice) => <button type="button" key={choice} className="grid h-12 w-12 place-items-center rounded-full border-4 border-white shadow-sm ring-1 ring-gray-200" style={{ backgroundColor: choice, color: brandTextColor(choice) }} aria-label={t('اختيار اللون ', 'Choose color ') + choice} aria-pressed={color === choice} onClick={() => setColor(choice)}>{color === choice && <Check size={20} />}</button>)}</div><label htmlFor={`${prefix}-color`} className="flex min-h-12 items-center gap-3"><span className="text-sm font-medium">{t('أو اختار لون تاني', 'Or choose another color')}</span><input id={`${prefix}-color`} type="color" name="brandColor" className="h-11 w-16 rounded-lg border border-gray-200 bg-white p-1" value={color} onChange={(event) => setColor(event.target.value)} /><span className="text-xs text-gray-500" dir="ltr">{color.toUpperCase()}</span></label></section>
        <details className="card"><summary className="cursor-pointer py-1 text-base font-bold">{t('كلام إضافي على المنيو · اختياري', 'Extra menu text · optional')}</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><label htmlFor={`${prefix}-badgeAr`}><span className="label">{t('اسم مختصر بالعربي', 'Short Arabic name')}</span><input id={`${prefix}-badgeAr`} className="input" name="badgeText" dir="rtl" maxLength={24} value={badgeAr} onChange={(event) => setBadgeAr(event.target.value)} /></label><label htmlFor={`${prefix}-badgeEn`}><span className="label">{t('اسم مختصر بالإنجليزي', 'Short English name')}</span><input id={`${prefix}-badgeEn`} className="input" name="badgeTextEn" dir="ltr" maxLength={24} value={badgeEn} onChange={(event) => setBadgeEn(event.target.value)} /></label><label htmlFor={`${prefix}-tagAr`}><span className="label">{t('جملة تعريفية بالعربي', 'Arabic tagline')}</span><input id={`${prefix}-tagAr`} className="input" name="taglineAr" dir="rtl" maxLength={120} value={taglineAr} onChange={(event) => setTaglineAr(event.target.value)} /></label><label htmlFor={`${prefix}-tagEn`}><span className="label">{t('جملة تعريفية بالإنجليزي', 'English tagline')}</span><input id={`${prefix}-tagEn`} className="input" name="taglineEn" dir="ltr" maxLength={120} value={taglineEn} onChange={(event) => setTaglineEn(event.target.value)} /></label></div></details>
      </fieldset>
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-label={t('معاينة شكل المنيو', 'Menu appearance preview')}><div className="h-32 bg-gray-100 sm:h-44">{cover && <img src={cover} alt="" className="h-full w-full object-cover" />}</div><div className="flex min-w-0 items-center gap-3 p-4 sm:p-5" style={{ backgroundColor: color, color: brandTextColor(color) }}>{logo ? <img src={logo} alt="" className="h-16 w-16 shrink-0 rounded-xl bg-white object-cover" /> : <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-white/15 text-xl font-black">{localizedName(locale, badgeAr, badgeEn) || localizedName(locale, nameAr, nameEn).slice(0, 1)}</div>}<div className="min-w-0"><h2 className="break-words text-xl font-black" dir="auto">{localizedName(locale, nameAr, nameEn)}</h2>{localizedName(locale, taglineAr, taglineEn) && <p className="mt-1 break-words text-sm" dir="auto">{localizedName(locale, taglineAr, taglineEn)}</p>}</div></div></section>
      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">{state.error && <p className="text-sm font-semibold text-red-700" role="alert">{localizeMessage(state.error, locale)}</p>}{state.ok && state.message && <p className="text-sm font-semibold text-green-800" role="status">{localizeMessage(state.message, locale)}</p>}<button type="submit" className="btn btn-primary btn-lg min-h-12 w-full sm:w-auto" disabled={busy}><Save size={19} />{pending ? t('بنحفظ التغييرات…', 'Saving changes…') : uploading ? t('استنى رفع الصورة…', 'Uploading photo…') : t('حفظ شكل المطعم', 'Save appearance')}</button><p className="text-xs leading-6 text-gray-500">{t('تغيير الاسم والشكل يحافظ على نفس رابط المنيو وأكواد QR.', 'Changing the name and appearance keeps your menu link and QR codes working.')}</p></div>
    </form>
  </main>;
}
