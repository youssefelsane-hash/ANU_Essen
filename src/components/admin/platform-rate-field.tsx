'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { formatMoney } from '@/lib/domain/misc';

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

/**
 * Platform money for one restaurant, with a live worked example so the owner sees exactly what the
 * customer pays and what the restaurant keeps:
 * - online fee = percentage of the food and/or a fixed amount per order (either may be 0);
 * - platform delivery = 0 (settled manually) or an amount paid by the customer or by the restaurant.
 */
export function PlatformRateField({ basisPoints, serviceFee = 0, deliveryFee = 0, deliveryPayer = 'CUSTOMER' }: { basisPoints: number; serviceFee?: number; deliveryFee?: number; deliveryPayer?: 'CUSTOMER' | 'RESTAURANT' }) {
  const { locale, t } = useLanguage();
  const [rate, setRate] = useState(String(basisPoints / 100));
  const [fixed, setFixed] = useState(String(serviceFee / 100));
  const [delivery, setDelivery] = useState(String(deliveryFee / 100));
  const [payer, setPayer] = useState(deliveryPayer);
  const r = num(rate), f = num(fixed), d = num(delivery);
  const valid = [r, f, d].every((v) => Number.isFinite(v) && v >= 0) && r <= 50;
  const money = (piasters: number) => formatMoney(Math.round(piasters), locale);

  // Example: 100 EGP of food, delivered.
  const food = 10_000;
  const pct = valid ? Math.round((food * Math.round(r * 100)) / 10_000) : 0;
  const fixedP = valid ? Math.round(f * 100) : 0;
  const delP = valid ? Math.round(d * 100) : 0;
  const customerPays = food + pct + fixedP + (payer === 'CUSTOMER' ? delP : 0);
  const restaurantGets = food - (payer === 'RESTAURANT' ? delP : 0);
  const platformGets = pct + fixedP + delP;

  return (
    <fieldset className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:col-span-2">
      <legend className="px-1 font-bold">{t('فلوس المنصة من المطعم ده', 'Platform money from this restaurant')}</legend>

      <div>
        <p className="mb-2 text-sm font-semibold">{t('١) رسوم المنصة على طلبات الأونلاين — بتتضاف على العميل', '1) Platform fee on online orders — paid by the customer')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">{t('نسبة من قيمة الأكل (%) — صفر لو مش عايز نسبة', 'Percentage of the food (%) — 0 for none')}</span>
            <input name="commissionPercent" type="number" min="0" max="50" step="0.01" required inputMode="decimal" dir="ltr" value={rate} onChange={(e) => setRate(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="label">{t('مبلغ ثابت على كل طلب (ج.م) — صفر لو مش عايز', 'Fixed amount per order (EGP) — 0 for none')}</span>
            <input name="serviceFee" type="number" min="0" max="500" step="0.5" required inputMode="decimal" dir="ltr" value={fixed} onChange={(e) => setFixed(e.target.value)} className="input" />
          </label>
        </div>
        <p className="mt-1 text-xs text-gray-600">{t('ينفع تستخدم النسبة لوحدها، أو المبلغ الثابت لوحده، أو الاتنين مع بعض. النسبة بتظهر للعميل جوه سعر الأكل، والمبلغ الثابت بيظهر كسطر «رسوم الخدمة». طلبات الكاشير مفيهاش رسوم منصة.', 'Use the percentage alone, the fixed amount alone, or both. The percentage is blended into food prices; the fixed amount shows as a “Service fee” line. Counter orders carry no platform fee.')}</p>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">{t('٢) توصيل المنصة (لو مندوبين المنصة هما اللي بيوصلوا)', '2) Platform delivery (when platform couriers deliver)')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">{t('أجرة التوصيل للطلب (ج.م) — صفر = بتحسبها يدوي', 'Delivery charge per order (EGP) — 0 = settled manually')}</span>
            <input name="platformDeliveryFee" type="number" min="0" max="500" step="0.5" required inputMode="decimal" dir="ltr" value={delivery} onChange={(e) => setDelivery(e.target.value)} className="input" />
          </label>
          <div className="block">
            <span className="label">{t('مين يدفعها؟', 'Who pays it?')}</span>
            <div className="grid gap-2">
              <label className="flex items-start gap-2 rounded-xl bg-white p-2 text-sm"><input type="radio" name="platformDeliveryPayer" value="CUSTOMER" checked={payer === 'CUSTOMER'} onChange={() => setPayer('CUSTOMER')} className="mt-1" /><span>{t('العميل — بتتزود على فاتورته', 'Customer — added to their bill')}</span></label>
              <label className="flex items-start gap-2 rounded-xl bg-white p-2 text-sm"><input type="radio" name="platformDeliveryPayer" value="RESTAURANT" checked={payer === 'RESTAURANT'} onChange={() => setPayer('RESTAURANT')} className="mt-1" /><span>{t('المطعم — بتتخصم من فلوس الأوردر', 'Restaurant — deducted from the order money')}</span></label>
            </div>
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-600">{t('بتتحسب على طلبات التوصيل بس (مش الاستلام من المحل). لو حطيت صفر، النظام مش هيحسب أجرة توصيل وانت بتتحاسب يدوي.', 'Applies to delivery orders only (not pickup). With 0 the system adds nothing and you settle delivery manually.')}</p>
      </div>

      {valid ? (
        <div className="rounded-xl bg-white p-3 text-sm leading-7" aria-live="polite">
          <b>{t('مثال: طلب أكل بـ ', 'Example: food worth ')}{money(food)}{t(' متوصّل:', ', delivered:')}</b>
          <div>{t('العميل يدفع: ', 'Customer pays: ')}<b>{money(customerPays)}</b> <span className="text-xs text-gray-500">{t('(+ رسوم توصيل المطعم لو موجودة)', '(+ the restaurant’s own delivery fee, if any)')}</span></div>
          <div>{t('المطعم ياخد: ', 'Restaurant keeps: ')}<b>{money(restaurantGets)}</b></div>
          <div>{t('المنصة تاخد: ', 'Platform receives: ')}<b>{money(platformGets)}</b> <span className="text-xs text-gray-500">({t('نسبة', 'percentage')} {money(pct)} + {t('ثابت', 'fixed')} {money(fixedP)} + {t('توصيل', 'delivery')} {money(delP)})</span></div>
        </div>
      ) : (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{t('اكتب أرقام صحيحة (النسبة من 0 لـ 50).', 'Enter valid numbers (percentage 0–50).')}</p>
      )}
      <p className="text-xs text-gray-600">{t('التغيير بيطبق على الطلبات الجديدة بس؛ الطلبات القديمة بتفضل بحسابها.', 'Changes apply to new orders only. Existing orders keep their original accounting.')}</p>
    </fieldset>
  );
}
