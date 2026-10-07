import Link from 'next/link';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import type { RefundQueueRow } from '@/server/services/refunds';

/** Refund work list shared by the restaurant screen and the platform admin. */
export async function RefundQueue({
  queue,
  timezone,
  orderHref,
  showRestaurant,
}: {
  queue: { open: RefundQueueRow[]; cancelledPaid: RefundQueueRow[]; history: RefundQueueRow[] };
  timezone: string;
  orderHref: (orderId: string) => string;
  showRestaurant: boolean;
}) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const money = (n: number) => formatMoney(n, locale);
  const method = (m: string) => (m === 'INSTAPAY' ? t('إنستاباي', 'InstaPay') : t('كاش', 'Cash'));

  const table = (rows: RefundQueueRow[], kind: 'open' | 'cancelled' | 'history') => (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{t('الطلب', 'Order')}</th>
            {showRestaurant && <th>{t('المطعم', 'Restaurant')}</th>}
            <th>{t('العميل', 'Customer')}</th>
            <th>{kind === 'history' ? t('النتيجة', 'Result') : t('المبلغ', 'Amount')}</th>
            <th>{t('السبب', 'Reason')}</th>
            <th>{t('الوقت', 'Time')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.orderId}-${r.refundId ?? 'c'}`}>
              <td className="font-bold" dir="ltr">#{r.orderNumber}</td>
              {showRestaurant && <td>{localizedName(locale, r.restaurantNameAr, r.restaurantNameEn)}</td>}
              <td>{r.customerName}</td>
              <td>
                {kind === 'history'
                  ? r.refundStatus === 'COMPLETED'
                    ? <span className="badge bg-green-100 text-green-800">{t('اترجع', 'Refunded')} {money(r.amount)}</span>
                    : <span className="badge bg-gray-100 text-gray-700">{t('مرفوض', 'Declined')}</span>
                  : <span className="font-semibold">{money(r.amount)} <span className="text-xs font-normal text-gray-500">• {method(r.paymentMethod)}</span></span>}
              </td>
              <td className="max-w-xs truncate text-sm">{r.reason ?? '—'}</td>
              <td className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(r.at, timezone, locale)}</td>
              <td><Link className="btn btn-secondary btn-sm" href={orderHref(r.orderId)}>{kind === 'history' ? t('عرض', 'View') : t('مراجعة', 'Review')}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <h2 className="font-bold">{t('طلبات استرجاع من العملاء', 'Customer refund requests')} ({queue.open.length})</h2>
        {queue.open.length ? table(queue.open, 'open') : <p className="text-sm text-gray-500">{t('مفيش طلبات مستنية. 👌', 'Nothing waiting. 👌')}</p>}
      </section>
      {queue.cancelledPaid.length > 0 && (
        <section className="card space-y-2 border-red-200">
          <h2 className="font-bold text-red-800">{t('طلبات اتلغت بعد ما العميل دفع', 'Cancelled after the customer paid')} ({queue.cancelledPaid.length})</h2>
          <p className="text-sm text-gray-600">{t('الفلوس لسه ما رجعتش للعميل. افتح الطلب ورجّع المبلغ.', 'The money has not been given back yet. Open the order and refund it.')}</p>
          {table(queue.cancelledPaid, 'cancelled')}
        </section>
      )}
      <section className="card space-y-2">
        <h2 className="font-bold">{t('آخر ٣٠ يوم', 'Last 30 days')}</h2>
        {queue.history.length ? table(queue.history, 'history') : <p className="text-sm text-gray-500">{t('مفيش مرتجعات.', 'No refunds yet.')}</p>}
      </section>
    </div>
  );
}
