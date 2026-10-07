import Link from 'next/link';
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders, restaurants } from '@/server/db/schema';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { Forbidden, PageTitle, Pagination } from '@/components/admin/ui';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/domain/order-machine';
import { PAYMENT_STATUS_TONE, STATUS_EN, STATUS_TONE } from '@/lib/labels';

export const dynamic = 'force-dynamic';
const PAGE = 50;

export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ restaurant?: string; status?: string; q?: string; page?: string }> }) {
  if (!(await adminPage('/admin/orders', 'platform.restaurants'))) return <Forbidden />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const tz = await platformTimezone();
  const where: SQL[] = [];
  if (sp.restaurant) where.push(eq(orders.restaurantId, sp.restaurant));
  if (sp.status && (ORDER_STATUSES as readonly string[]).includes(sp.status)) where.push(eq(orders.status, sp.status as OrderStatus));
  if (sp.q) {
    const q = sp.q.trim().slice(0, 40);
    where.push(or(ilike(orders.orderNumber, `%${q}%`), ilike(orders.customerPhone, `%${q}%`), ilike(orders.customerName, `%${q}%`))!);
  }
  const [list, restaurantList] = await Promise.all([
    db()
      .select({ o: orders, restaurant: restaurants.nameEn })
      .from(orders)
      .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(orders.createdAt))
      .limit(PAGE + 1)
      .offset((page - 1) * PAGE),
    db().select({ id: restaurants.id, nameEn: restaurants.nameEn }).from(restaurants).orderBy(asc(restaurants.nameEn)),
  ]);
  const qs = new URLSearchParams(Object.entries({ restaurant: sp.restaurant ?? '', status: sp.status ?? '', q: sp.q ?? '' }).filter(([, v]) => v)).toString();

  return (
    <div>
      <PageTitle title="Orders" />
      <form className="card mb-4 grid gap-2 md:grid-cols-4">
        <select name="restaurant" defaultValue={sp.restaurant ?? ''} className="input">
          <option value="">All restaurants</option>
          {restaurantList.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="input">
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_EN[s]}</option>)}
        </select>
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Order #, phone or name" className="input" />
        <button className="btn btn-secondary">Filter</button>
      </form>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>#</th><th>Restaurant</th><th>Customer</th><th>Status</th><th>Payment</th><th>Total</th><th>Commission</th><th>Created</th></tr></thead>
          <tbody>
            {list.slice(0, PAGE).map(({ o, restaurant }) => (
              <tr key={o.id}>
                <td><Link className="font-bold text-blue-700" href={`/admin/orders/${o.id}`}>{o.orderNumber}</Link></td>
                <td>{restaurant}</td>
                <td>{o.customerName}<div className="text-xs text-gray-500">{o.customerPhone}</div></td>
                <td><span className={`badge ${STATUS_TONE[o.status]}`}>{STATUS_EN[o.status]}</span></td>
                <td><span className={`badge ${PAYMENT_STATUS_TONE[o.paymentStatus]}`}>{o.paymentMethod} · {o.paymentStatus}</span></td>
                <td>{formatMoney(o.total, 'en')}</td>
                <td>{formatMoney(o.commissionAmount, 'en')}</td>
                <td className="text-xs text-gray-500">{formatDateTime(o.createdAt, tz)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="py-6 text-center text-gray-400">No orders</p>}
        <Pagination page={page} hasMore={list.length > PAGE} base={`/admin/orders${qs ? `?${qs}` : ''}`} />
      </section>
    </div>
  );
}
