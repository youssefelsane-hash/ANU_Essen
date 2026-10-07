import Link from 'next/link';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders } from '@/server/db/schema';
import { merchantContext } from '@/server/merchant-context';
import { activeCounts, courierSummary, periodStats, salesBySource } from '@/server/services/stats';
import { localDateString, localDateToUtc, startOfLocalDay } from '@/lib/domain/hours';
import { formatMoney, formatTime } from '@/lib/domain/misc';
import { STATUS_TONE } from '@/lib/labels';
import { getLocale } from '@/lib/i18n/server';
import { text, labels } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

function Stat({ label, value, tone = '' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`card ${tone}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}

export default async function MerchantDashboard({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const copy = labels(locale);
  const { restaurant, permissions } = await merchantContext('/merchant/dashboard');
  if (!restaurant || !permissions.has('reports.view')) return <p className="p-6 text-center">{t('لا تملك صلاحية عرض التقارير.', 'You do not have permission to view reports.')}</p>;
  const tz = restaurant.timezone;
  const { date } = await searchParams;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDateString(new Date(), tz);
  const from = date ? localDateToUtc(day, tz) : startOfLocalDay(new Date(), tz);
  const nextDay = new Date(`${day}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const to = localDateToUtc(nextDay.toISOString().slice(0, 10), tz);

  const [stats, active, list, sources, couriers] = await Promise.all([
    periodStats(db(), from, to, restaurant.id),
    activeCounts(db(), restaurant.id),
    db()
      .select()
      .from(orders)
      .where(and(eq(orders.restaurantId, restaurant.id), gte(orders.createdAt, from), lt(orders.createdAt, to)))
      .orderBy(desc(orders.createdAt))
      .limit(300),
    salesBySource(db(), from, to, restaurant.id),
    courierSummary(db(), restaurant.id, from, to),
  ]);
  const pending = (active.CREATED ?? 0) + (active.AWAITING_PAYMENT ?? 0) + (active.PAYMENT_REVIEW ?? 0);

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('ملخص اليوم', 'Today at a glance')}</h1>
        <form className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="date">{t('التاريخ', 'Date')}</label>
            <input id="date" type="date" name="date" defaultValue={day} className="input" />
          </div>
          <button className="btn btn-secondary">{t('عرض', 'Show')}</button>
        </form>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('طلبات اليوم', 'Today’s orders')} value={stats.orders} />
        <Stat label={t('المبيعات المسلّمة', 'Delivered sales')} value={formatMoney(stats.sales, locale)} tone="ring-green-200" />
        <Stat label={t('بانتظار القبول أو الدفع', 'Awaiting acceptance or payment')} value={pending} />
        <Stat label={t('في المطبخ', 'In the kitchen')} value={(active.CONFIRMED ?? 0) + (active.PREPARING ?? 0)} />
      </div>
      <Link className="btn btn-primary" href="/merchant">{t('فتح شاشة الطلبات', 'Open order board')}</Link>
      <details className="card">
        <summary className="cursor-pointer font-bold">{t('أرقام إضافية', 'More figures')}</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('طلبات مكتملة', 'Completed orders')} value={stats.completed} />
          <Stat label={t('متوسط الطلب', 'Average order')} value={formatMoney(stats.avgOrder, locale)} />
          <Stat label={t('جاهزة أو في الطريق', 'Ready or on the way')} value={(active.READY ?? 0) + (active.OUT_FOR_DELIVERY ?? 0) + (active.ARRIVED_AT_GATE ?? 0)} />
          <Stat label={t('ملغية', 'Cancelled')} value={stats.cancelled} />
        </div>
      </details>

      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">{t('سجل الطلبات', 'Order history')} ({list.length})</h2>
        <table className="table">
          <thead>
            <tr><th>#</th><th>{t('الوقت', 'Time')}</th><th>{t('العميل', 'Customer')}</th><th>{t('الحالة', 'Status')}</th><th>{t('الدفع', 'Payment')}</th><th>{t('الإجمالي', 'Total')}</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td className="font-bold" dir="ltr">{o.orderNumber}</td>
                <td>{formatTime(o.createdAt, tz, locale)}</td>
                <td>{o.customerName}</td>
                <td><span className={`badge ${STATUS_TONE[o.status]}`}>{copy.status[o.status]}</span></td>
                <td>{copy.paymentMethod[o.paymentMethod]}</td>
                <td>{formatMoney(o.total, locale)}</td>
                <td><Link className="text-blue-700" href={`/merchant/orders/${o.id}`}>{t('تفاصيل', 'Details')}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="py-6 text-center text-gray-400">{t('لا توجد طلبات في هذا اليوم', 'No orders on this day')}</p>}
      </section>

      {couriers.length > 0 && (
        <details className="card overflow-x-auto">
          <summary className="mb-3 cursor-pointer font-bold">{t('الدليفري — تسليم وتحصيل اليوم', 'Couriers — today’s deliveries & cash')}</summary>
          <table className="table">
            <thead><tr><th>{t('الدليفري', 'Courier')}</th><th>{t('في الطريق', 'On the way')}</th><th>{t('اتسلّم', 'Delivered')}</th><th>{t('كاش اتحصّل (يتسلّم للكاشير)', 'Cash collected (to hand to the cashier)')}</th><th>{t('كاش لسه هيتحصّل', 'Cash still to collect')}</th></tr></thead>
            <tbody>
              {couriers.map((c) => (
                <tr key={c.userId}><td className="font-semibold">{c.name}</td><td>{c.onTheWay}</td><td>{c.delivered}</td><td className="font-bold">{formatMoney(c.cashCollected, locale)}</td><td>{formatMoney(c.cashPending, locale)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {sources.length > 0 && (
        <details className="card">
          <summary className="mb-3 cursor-pointer font-bold">{t('مصدر الطلبات (رموز الطلب)', 'Order sources (QR posters)')}</summary>
          <table className="table">
            <thead><tr><th>{t('المصدر', 'Source')}</th><th>{t('طلبات', 'Orders')}</th><th>{t('مكتملة', 'Completed')}</th><th>{t('مبيعات', 'Sales')}</th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source}><td dir="ltr">{s.source}</td><td>{s.orders}</td><td>{s.completed}</td><td>{formatMoney(s.sales, locale)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </main>
  );
}
