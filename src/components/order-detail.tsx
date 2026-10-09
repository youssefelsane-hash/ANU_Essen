import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import { PAYMENT_STATUS_TONE, STATUS_TONE } from '@/lib/labels';
import type { OrderSnapshot } from '@/lib/types';
import { PrintButton } from './merchant/receipt';
import { RefundPanel } from './refund-panel';
import { NoShowButton } from './no-show-button';
import { labels, localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

/** Shared order detail (merchant + admin). Commission is passed only to platform viewers. */
export async function OrderDetail({
  order: o,
  restaurantName,
  timezone,
  commission,
  canPrint,
  canRefund = false,
  canCancel = false,
}: {
  order: OrderSnapshot;
  restaurantName: string;
  timezone: string;
  commission?: { bps: number; amount: number; merchantNet: number; source: string | null; serviceFee?: number; platformDeliveryFee?: number; platformDeliveryPayer?: 'CUSTOMER' | 'RESTAURANT' | null } | null;
  canPrint: boolean;
  canRefund?: boolean;
  canCancel?: boolean;
}) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const l = labels(locale);
  const money = (amount: number) => formatMoney(amount, locale);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-black" dir="ltr">#{o.orderNumber}</h1>
          <div className="flex gap-2">
            <span className={`badge ${STATUS_TONE[o.status]}`}>{l.status[o.status]}</span>
            <span className={`badge ${PAYMENT_STATUS_TONE[o.paymentStatus]}`}>{l.paymentMethod[o.paymentMethod]} • {l.paymentStatus[o.paymentStatus]}</span>
          </div>
        </div>
        <div className="text-sm text-gray-600">
          {o.customerName} {o.customerPhone && <a className="inline-flex min-h-11 items-center rounded-lg px-2 font-bold text-emerald-800 underline" dir="ltr" href={'tel:' + o.customerPhone}>☎ {o.customerPhone}</a>} • {localizedName(locale, o.deliveryPointName, o.deliveryPointNameEn)}
        </div>
        {o.customerNote && <p className="rounded-lg bg-yellow-50 p-2 text-sm">📝 {o.customerNote}</p>}
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>{t('العدد', 'Qty')}</th><th>{t('الصنف', 'Item')}</th><th>{t('سعر الوحدة', 'Unit price')}</th><th>{t('الإجمالي', 'Total')}</th></tr></thead>
          <tbody>
            {o.items.map((it) => (
              <tr key={it.id}>
                <td className="w-12 font-bold">{it.quantity}×</td>
                <td>
                  {localizedName(locale, it.nameAr, it.nameEn)} {it.variantNameAr && <span className="text-gray-500">({localizedName(locale, it.variantNameAr, it.variantNameEn)})</span>}
                  {it.addons.length > 0 && <div className="text-xs text-gray-500">+ {it.addons.map((a) => `${localizedName(locale, a.nameAr, a.nameEn)} (${money(a.price)})`).join(t('، ', ', '))}</div>}
                  {it.note && <p className="text-xs text-gray-500">{it.note}</p>}
                </td>
                <td className="text-end">{money(it.unitPrice + it.addonsPerUnit)}</td>
                <td className="text-end font-semibold">{money(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="ms-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span>{t('المجموع', 'Subtotal')}</span><span>{money(o.subtotal)}</span></div>
          {o.discountTotal > 0 && <div className="flex justify-between text-green-700"><span>{t('الخصم', 'Discount')} {o.promoCode ? `(${o.promoCode})` : ''}</span><span>-{money(o.discountTotal)}</span></div>}
          {commission && (o.platformFeeAmount ?? 0) > 0 && <div className="flex justify-between"><span>{t('رسوم المنصة', 'Platform fee')}</span><span>{money(o.platformFeeAmount ?? 0)}</span></div>}
          {o.deliveryFee > 0 && <div className="flex justify-between"><span>{t('التوصيل', 'Delivery')}</span><span>{money(o.deliveryFee)}</span></div>}
          {(o.serviceFee ?? 0) > 0 && <div className="flex justify-between"><span>{t('رسوم الخدمة', 'Service fee')}</span><span>{money(o.serviceFee ?? 0)}</span></div>}
          <div className="flex justify-between text-base font-extrabold"><span>{t('الإجمالي', 'Total')}</span><span>{money(o.total)}</span></div>
          {(o.refundedTotal ?? 0) > 0 && <div className="flex justify-between font-semibold text-amber-800"><span>{t('مسترد للعميل', 'Refunded')}</span><span>-{money(o.refundedTotal ?? 0)}</span></div>}
          {commission && (
            <div className="mt-2 rounded-lg bg-indigo-50 p-2 text-xs text-indigo-900">
              {t('مستحقات المنصة', 'Platform share')} = {money(commission.amount)}
              {' ('}{o.pricingMode === 'ONLINE_PLATFORM_FEE' ? t('نسبة', 'percentage') : t('عمولة', 'commission')} {(commission.bps / 100).toFixed(2)}%
              {(commission.serviceFee ?? 0) > 0 && <> + {t('رسوم ثابتة', 'fixed fee')} {money(commission.serviceFee ?? 0)}</>}
              {(commission.platformDeliveryFee ?? 0) > 0 && <> + {t('توصيل المنصة', 'platform delivery')} {money(commission.platformDeliveryFee ?? 0)} ({commission.platformDeliveryPayer === 'RESTAURANT' ? t('مخصوم من المطعم', 'deducted from restaurant') : t('على العميل', 'paid by customer')})</>}
              {')'} • {t('صافي المطعم', 'Restaurant net')} {money(commission.merchantNet)}
              {commission.source && <> • {t('مصدر الطلب', 'Order source')}: {commission.source}</>}
            </div>
          )}
        </div>
        {o.paymentReference && <p className="text-sm">{t('رقم عملية التحويل', 'Transfer reference')}: <b dir="ltr">{o.paymentReference}</b></p>}
        {o.hasPaymentAttachment && <a className="text-sm text-blue-700 underline" href={`/api/merchant/orders/${o.id}/attachment`} target="_blank" rel="noreferrer">📎 {t('صورة التحويل', 'Payment screenshot')}</a>}
        {o.cancelReason && <p className="text-sm text-red-700">{t('سبب الإلغاء', 'Cancellation reason')}: {o.cancelReason}</p>}
        {canPrint && <PrintButton order={o} restaurantName={restaurantName} timezone={timezone} />}
        {canCancel && ['READY', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE'].includes(o.status) && <NoShowButton orderId={o.id} />}
      </section>
      <div className="space-y-4">
      <RefundPanel order={o} timezone={timezone} canRefund={canRefund} />
      <section className="card">
        <h2 className="mb-3 font-bold">{t('مراحل الطلب', 'Order history')}</h2>
        <ol className="space-y-3 border-s-2 border-gray-200 ps-4">
          {o.timeline.map((e, i) => (
            <li key={i} className="text-sm">
              <div className="text-xs text-gray-500">{formatDateTime(e.occurredAt, timezone, locale)}</div>
              <div className="font-semibold">
                {e.type === 'ORDER_CREATED' ? t('تم إنشاء الطلب', 'Order placed') : e.type === 'REFUNDED' ? t('تم استرداد مبلغ للعميل', 'Money refunded') : e.type === 'REFUND_REQUESTED' ? t('العميل طلب استرجاع', 'Customer asked for a refund') : e.type === 'REFUND_REJECTED' ? t('تم رفض طلب الاسترجاع', 'Refund request declined') : e.type === 'DELIVERY_REASSIGNED' ? t('تم تغيير مسؤول التوصيل', 'Courier changed') : e.action ? l.action[e.action as keyof typeof l.action] ?? t('تم تحديث الطلب', 'Order updated') : t('تم تحديث الطلب', 'Order updated')}
                {e.toStatus && <span className="text-gray-500"> → {l.status[e.toStatus]}</span>}
              </div>
              <div className="text-xs text-gray-500">{e.actor === 'customer' ? t('العميل', 'Customer') : e.actor === 'system' ? t('النظام', 'System') : e.actor === 'staff' ? t('فريق المطعم', 'Restaurant team') : e.actor}{e.note ? ` — ${e.note}` : ''}</div>
            </li>
          ))}
        </ol>
      </section>
      </div>
    </div>
  );
}
