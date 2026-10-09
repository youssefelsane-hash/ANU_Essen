'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { formatMoney } from '@/lib/domain/misc';

export function PlatformRateField({ basisPoints }: { basisPoints: number }) {
  const { locale, t } = useLanguage();
  const [rate, setRate] = useState(String(basisPoints / 100));
  const value = Number(rate);
  const valid = rate.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 50;
  const fee = valid ? Math.round(10_000 * Math.round(value * 100) / 10_000) : 0;
  return (
    <fieldset className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:col-span-2">
      <legend className="px-1 font-bold">{t('نسبة المنصة على الأونلاين', 'Online platform fee')}</legend>
      <label className="block max-w-64">
        <span className="label">{t('الزيادة فوق سعر المطعم (%)', 'Added to the restaurant price (%)')}</span>
        <input name="commissionPercent" type="number" min="0" max="50" step="0.01" required inputMode="decimal" dir="ltr" value={rate} onChange={(event) => setRate(event.target.value)} className="input" />
      </label>
      <p className="mt-2 text-sm leading-relaxed">{t('يدفعها العميل في طلبات الأونلاين فقط. سعر المطعم يصل له كاملًا بعد أي خصم، وطلبات الكاشير بدون نسبة منصة.', 'Customers pay this fee on online orders only. The restaurant keeps its full price after discounts. Counter orders have no platform fee.')}</p>
      {valid && <p className="mt-3 rounded-xl bg-white p-3 text-sm" aria-live="polite">{t('مثال: أكل بقيمة ', 'Example: food worth ')}<b>{formatMoney(10_000, locale)}</b>{t(' ← العميل يدفع ', ' → customer pays ')}<b>{formatMoney(10_000 + fee, locale)}</b>{t('، المطعم له ', ', restaurant receives ')}<b>{formatMoney(10_000, locale)}</b>{t('، والمنصة لها ', ', platform receives ')}<b>{formatMoney(fee, locale)}</b>{t('. التوصيل يُضاف بشكل مستقل.', '. Delivery is added separately.')}</p>}
      <p className="mt-2 text-xs text-gray-600">{t('تسري على الطلبات الجديدة فقط؛ الطلبات السابقة تحتفظ بحسابها وقت الإنشاء.', 'Applies to new orders only. Existing orders keep their original accounting.')}</p>
    </fieldset>
  );
}
