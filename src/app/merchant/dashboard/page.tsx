import Link from 'next/link';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders } from '@/server/db/schema';
import { merchantContext } from '@/server/merchant-context';
import { activeCounts, periodStats, salesBySource } from '@/server/services/stats';
import { localDateString, localDateToUtc, startOfLocalDay } from '@/lib/domain/hours';
import { formatMoney, formatTime } from '@/lib/domain/misc';
import { PAYMENT_METHOD_AR, STATUS_AR, STATUS_TONE } from '@/lib/labels';

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
  const { restaurant, permissions } = await merchantContext('/merchant/dashboard');
  if (!restaurant || !permissions.has('reports.view')) return <p className="p-6 text-center">مش مسموح.</p>;
  const tz = restaurant.timezone;
  const { date } = await searchParams;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDateString(new Date(), tz);
  const from = date ? localDateToUtc(day, tz) : startOfLocalDay(new Date(), tz);
  const to = new Date(from.getTime() + 24 * 3600_000);

  const [stats, active, list, sources] = await Promise.all([
    periodStats(db(), from, to, restaurant.id),
    activeCounts(db(), restaurant.id),
    db()
      .select()
      .from(orders)
      .where(and(eq(orders.restaurantId, restaurant.id), gte(orders.createdAt, from), lt(orders.createdAt, to)))
      .orderBy(desc(orders.createdAt))
      .limit(300),
    salesBySource(db(), from, to, restaurant.id),
  ]);
  const pending = (active.CREATED ?? 0) + (active.AWAITING_PAYMENT ?? 0) + (active.PAYMENT_REVIEW ?? 0);

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">ملخص اليوم</h1>
        <form className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="date">التاريخ</label>
            <input id="date" type="date" name="date" defaultValue={day} className="input" />
          </div>
          <button className="btn btn-secondary">عرض</button>
        </form>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="طلبات اليوم" value={stats.orders} />
        <Stat label="مبيعات اليوم (المسلّمة)" value={formatMoney(stats.sales)} tone="ring-green-200" />
        <Stat label="متوسط الطلب" value={formatMoney(stats.avgOrder)} />
        <Stat label="مكتملة" value={stats.completed} />
        <Stat label="معلقة (دفع/قبول)" value={pending} />
        <Stat label="في المطبخ" value={(active.CONFIRMED ?? 0) + (active.PREPARING ?? 0)} />
        <Stat label="جاهزة / في الطريق" value={(active.READY ?? 0) + (active.OUT_FOR_DELIVERY ?? 0) + (active.ARRIVED_AT_GATE ?? 0)} />
        <Stat label="ملغية" value={stats.cancelled} />
      </div>

      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">سجل الطلبات ({list.length})</h2>
        <table className="table">
          <thead>
            <tr><th>#</th><th>الوقت</th><th>العميل</th><th>الحالة</th><th>الدفع</th><th>الإجمالي</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td className="font-bold" dir="ltr">{o.orderNumber}</td>
                <td>{formatTime(o.createdAt, tz)}</td>
                <td>{o.customerName}</td>
                <td><span className={`badge ${STATUS_TONE[o.status]}`}>{STATUS_AR[o.status]}</span></td>
                <td>{PAYMENT_METHOD_AR[o.paymentMethod]}</td>
                <td>{formatMoney(o.total)}</td>
                <td><Link className="text-blue-700" href={`/merchant/orders/${o.id}`}>تفاصيل</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="py-6 text-center text-gray-400">لا توجد طلبات في هذا اليوم</p>}
      </section>

      {sources.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-bold">مصدر الطلبات (QR posters)</h2>
          <table className="table">
            <thead><tr><th>المصدر</th><th>طلبات</th><th>مكتملة</th><th>مبيعات</th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source}><td dir="ltr">{s.source}</td><td>{s.orders}</td><td>{s.completed}</td><td>{formatMoney(s.sales)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
