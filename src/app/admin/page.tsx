import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders, restaurants } from '@/server/db/schema';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { activeCounts, financeByRestaurant, periodStats } from '@/server/services/stats';
import { Forbidden, PageTitle, Stat } from '@/components/admin/ui';
import { startOfLocalDay } from '@/lib/domain/hours';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import { STATUS_EN, STATUS_TONE } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const auth = await adminPage('/admin', 'platform.finance');
  if (!auth) return <Forbidden />;
  const tz = await platformTimezone();
  const from = startOfLocalDay(new Date(), tz);
  const to = new Date(from.getTime() + 24 * 3600_000);
  const [today, active, finance, latest] = await Promise.all([
    periodStats(db(), from, to),
    activeCounts(db()),
    financeByRestaurant(db(), from, to),
    db()
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, total: orders.total, createdAt: orders.createdAt, restaurant: restaurants.nameEn, customer: orders.customerName })
      .from(orders)
      .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
      .orderBy(desc(orders.createdAt))
      .limit(10),
  ]);
  const activeTotal = Object.values(active).reduce((s, n) => s + (n ?? 0), 0);
  const all = finance.reduce((acc, f) => ({ sales: acc.sales + f.allTime.sales, commission: acc.commission + f.allTime.commission, paid: acc.paid + f.allTime.paid, outstanding: acc.outstanding + f.allTime.outstanding }), { sales: 0, commission: 0, paid: 0, outstanding: 0 });
  const m = (v: number) => formatMoney(v, 'en');

  return (
    <div className="space-y-6">
      <PageTitle title="Overview" subtitle={`Today (${tz}) — sales are counted when orders are completed`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orders today" value={today.orders} />
        <Stat label="Sales today" value={m(today.sales)} />
        <Stat label="Platform revenue today" value={m(today.commission)} />
        <Stat label="Average order value" value={m(today.avgOrder)} />
        <Stat label="Active orders (now)" value={activeTotal} />
        <Stat label="Completed today" value={today.completed} />
        <Stat label="Cancelled today" value={today.cancelled} />
        <Stat label="Discounts today" value={m(today.discounts)} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="All-time sales" value={m(all.sales)} />
        <Stat label="My commission (all time)" value={m(all.commission)} />
        <Stat label="Commission paid" value={m(all.paid)} />
        <Stat label="Commission outstanding" value={m(all.outstanding)} />
      </div>
      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">Restaurants today</h2>
        <table className="table">
          <thead><tr><th>Restaurant</th><th>Completed</th><th>Sales</th><th>Commission</th><th>Outstanding (all time)</th></tr></thead>
          <tbody>
            {finance.map((f) => (
              <tr key={f.restaurantId}>
                <td><Link className="text-blue-700" href={`/admin/restaurants/${f.restaurantId}`}>{f.nameEn}</Link> <span className="text-gray-400">{f.nameAr}</span></td>
                <td>{f.period.completed}</td>
                <td>{m(f.period.sales)}</td>
                <td>{m(f.period.commission)}</td>
                <td className={f.allTime.outstanding > 0 ? 'font-semibold text-amber-700' : ''}>{m(f.allTime.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">Latest orders</h2>
        <table className="table">
          <tbody>
            {latest.map((o) => (
              <tr key={o.id}>
                <td><Link className="font-bold text-blue-700" href={`/admin/orders/${o.id}`}>#{o.orderNumber}</Link></td>
                <td>{o.restaurant}</td>
                <td>{o.customer}</td>
                <td><span className={`badge ${STATUS_TONE[o.status]}`}>{STATUS_EN[o.status]}</span></td>
                <td>{m(o.total)}</td>
                <td className="text-xs text-gray-500">{formatDateTime(o.createdAt, tz)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
