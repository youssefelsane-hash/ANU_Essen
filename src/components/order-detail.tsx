import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import { ACTION_AR, PAYMENT_METHOD_AR, PAYMENT_STATUS_AR, PAYMENT_STATUS_TONE, STATUS_AR, STATUS_TONE } from '@/lib/labels';
import type { OrderSnapshot } from '@/lib/types';
import { PrintButton } from './merchant/receipt';

/** Shared order detail (merchant + admin). Commission is passed only to platform viewers. */
export function OrderDetail({
  order: o,
  restaurantName,
  timezone,
  commission,
  canPrint,
}: {
  order: OrderSnapshot;
  restaurantName: string;
  timezone: string;
  commission?: { bps: number; amount: number; merchantNet: number; source: string | null } | null;
  canPrint: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-black" dir="ltr">#{o.orderNumber}</h1>
          <div className="flex gap-2">
            <span className={`badge ${STATUS_TONE[o.status]}`}>{STATUS_AR[o.status]}</span>
            <span className={`badge ${PAYMENT_STATUS_TONE[o.paymentStatus]}`}>{PAYMENT_METHOD_AR[o.paymentMethod]} • {PAYMENT_STATUS_AR[o.paymentStatus]}</span>
          </div>
        </div>
        <div className="text-sm text-gray-600">
          {o.customerName} {o.customerPhone && <span dir="ltr">• {o.customerPhone}</span>} • {o.deliveryPointName}
        </div>
        {o.customerNote && <p className="rounded-lg bg-yellow-50 p-2 text-sm">📝 {o.customerNote}</p>}
        <table className="table">
          <tbody>
            {o.items.map((it) => (
              <tr key={it.id}>
                <td className="w-12 font-bold">{it.quantity}×</td>
                <td>
                  {it.nameAr} {it.variantNameAr && <span className="text-gray-500">({it.variantNameAr})</span>}
                  {it.addons.length > 0 && <div className="text-xs text-gray-500">+ {it.addons.map((a) => `${a.nameAr} (${formatMoney(a.price)})`).join('، ')}</div>}
                </td>
                <td className="text-end">{formatMoney(it.unitPrice + it.addonsPerUnit)}</td>
                <td className="text-end font-semibold">{formatMoney(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ms-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span>المجموع</span><span>{formatMoney(o.subtotal)}</span></div>
          {o.discountTotal > 0 && <div className="flex justify-between text-green-700"><span>الخصم {o.promoCode ? `(${o.promoCode})` : ''}</span><span>-{formatMoney(o.discountTotal)}</span></div>}
          {o.deliveryFee > 0 && <div className="flex justify-between"><span>التوصيل</span><span>{formatMoney(o.deliveryFee)}</span></div>}
          <div className="flex justify-between text-base font-extrabold"><span>الإجمالي</span><span>{formatMoney(o.total)}</span></div>
          {commission && (
            <div className="mt-2 rounded-lg bg-indigo-50 p-2 text-xs text-indigo-900" dir="ltr">
              Platform commission {(commission.bps / 100).toFixed(2)}% = {formatMoney(commission.amount, 'en')} • Merchant net {formatMoney(commission.merchantNet, 'en')}
              {commission.source && <> • source: {commission.source}</>}
            </div>
          )}
        </div>
        {o.paymentReference && <p className="text-sm">رقم عملية التحويل: <b dir="ltr">{o.paymentReference}</b></p>}
        {o.hasPaymentAttachment && <a className="text-sm text-blue-700 underline" href={`/api/merchant/orders/${o.id}/attachment`} target="_blank" rel="noreferrer">📎 صورة التحويل</a>}
        {o.cancelReason && <p className="text-sm text-red-700">سبب الإلغاء: {o.cancelReason}</p>}
        {canPrint && <PrintButton order={o} restaurantName={restaurantName} timezone={timezone} />}
      </section>
      <section className="card">
        <h2 className="mb-3 font-bold">Timeline</h2>
        <ol className="space-y-3 border-s-2 border-gray-200 ps-4">
          {o.timeline.map((e, i) => (
            <li key={i} className="text-sm">
              <div className="font-mono text-xs text-gray-500" dir="ltr">{formatDateTime(e.occurredAt, timezone)}</div>
              <div className="font-semibold">
                {e.type === 'ORDER_CREATED' ? 'تم إنشاء الطلب' : e.action ? ACTION_AR[e.action as keyof typeof ACTION_AR] ?? e.action : e.type}
                {e.toStatus && <span className="text-gray-500"> → {STATUS_AR[e.toStatus]}</span>}
              </div>
              <div className="text-xs text-gray-500">{e.actor}{e.note ? ` — ${e.note}` : ''}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
