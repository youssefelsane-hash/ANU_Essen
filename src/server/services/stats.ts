import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db';
import { orders, refunds, restaurants, settlements, users } from '../db/schema';
import { ACTIVE_STATUSES, type OrderStatus } from '../../lib/domain/order-machine';

const money = (col: unknown) => sql<number>`coalesce(sum(${col}), 0)::float8`;

export interface PeriodStats {
  orders: number;
  completed: number;
  cancelled: number;
  /** Net of refunds. */
  sales: number;
  grossSales: number;
  refunds: number;
  refundCount: number;
  discounts: number;
  commission: number;
  merchantNet: number;
  avgOrder: number;
}

interface RefundTotals { restaurantId: string; count: number; amount: number; commissionReversed: number }

/**
 * Money given back on COMPLETED orders (refunds of cancelled orders were never counted as sales).
 * A refund is recognised at the later of the refund and the order completion, so it always lands in
 * the same or a later period than the sale it reduces.
 */
async function refundTotals(d: Db, range: { from: Date; to: Date } | null, restaurantId?: string): Promise<RefundTotals[]> {
  const at = sql`greatest(${refunds.decidedAt}, ${orders.completedAt})`;
  const rows = await d
    .select({
      restaurantId: refunds.restaurantId,
      count: sql<number>`count(*)::int`,
      amount: money(refunds.amount),
      commissionReversed: money(refunds.commissionReversed),
    })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .where(and(
      eq(refunds.status, 'COMPLETED'),
      eq(orders.status, 'COMPLETED'),
      ...(range ? [sql`${at} >= ${range.from.toISOString()}::timestamptz`, sql`${at} < ${range.to.toISOString()}::timestamptz`] : []),
      ...(restaurantId ? [eq(refunds.restaurantId, restaurantId)] : []),
    ))
    .groupBy(refunds.restaurantId);
  return rows.map((r) => ({ restaurantId: r.restaurantId, count: Number(r.count), amount: Number(r.amount), commissionReversed: Number(r.commissionReversed) }));
}

const sumRefunds = (rows: RefundTotals[]) => rows.reduce((a, r) => ({ count: a.count + r.count, amount: a.amount + r.amount, commissionReversed: a.commissionReversed + r.commissionReversed }), { count: 0, amount: 0, commissionReversed: 0 });

/** Sales are recognised when an order is COMPLETED (net of refunds); order counts by creation time. */
export async function periodStats(d: Db, from: Date, to: Date, restaurantId?: string): Promise<PeriodStats> {
  const scope: SQL[] = restaurantId ? [eq(orders.restaurantId, restaurantId)] : [];
  const [created] = await d
    .select({
      orders: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) filter (where ${orders.status} = 'CANCELLED')::int`,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, from), lt(orders.createdAt, to), ...scope));
  const [done] = await d
    .select({
      completed: sql<number>`count(*)::int`,
      sales: money(orders.total),
      discounts: money(orders.discountTotal),
      commission: money(orders.commissionAmount),
      merchantNet: money(orders.merchantNet),
    })
    .from(orders)
    .where(and(eq(orders.status, 'COMPLETED'), gte(orders.completedAt, from), lt(orders.completedAt, to), ...scope));
  const refunded = sumRefunds(await refundTotals(d, { from, to }, restaurantId));
  const completed = Number(done.completed);
  const grossSales = Number(done.sales);
  return {
    orders: Number(created.orders),
    cancelled: Number(created.cancelled),
    completed,
    sales: grossSales - refunded.amount,
    grossSales,
    refunds: refunded.amount,
    refundCount: refunded.count,
    discounts: Number(done.discounts),
    commission: Number(done.commission) - refunded.commissionReversed,
    merchantNet: Number(done.merchantNet) - (refunded.amount - refunded.commissionReversed),
    avgOrder: completed ? Math.round(grossSales / completed) : 0,
  };
}

/** Live counts of in-progress orders by status. */
export async function activeCounts(d: Db, restaurantId?: string): Promise<Partial<Record<OrderStatus, number>>> {
  const rows = await d
    .select({ status: orders.status, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(inArray(orders.status, [...ACTIVE_STATUSES]), ...(restaurantId ? [eq(orders.restaurantId, restaurantId)] : [])))
    .groupBy(orders.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export interface RestaurantFinance {
  restaurantId: string;
  nameAr: string;
  nameEn: string;
  commissionBps: number;
  /** sales / commission / merchantNet are net of refunds. */
  period: { completed: number; sales: number; refunds: number; discounts: number; commission: number; merchantNet: number };
  allTime: { sales: number; commission: number; paid: number; outstanding: number };
}

/**
 * Platform commission ledger: commission is accrued from completed orders' snapshots, minus the share
 * given back with refunds; settlements are payments received.
 */
export async function financeByRestaurant(d: Db, from: Date, to: Date): Promise<RestaurantFinance[]> {
  const [list, period, allTime, paid, periodRefunds, allRefunds] = await Promise.all([
    d.select().from(restaurants).orderBy(asc(restaurants.nameAr)),
    d
      .select({
        restaurantId: orders.restaurantId,
        completed: sql<number>`count(*)::int`,
        sales: money(orders.total),
        discounts: money(orders.discountTotal),
        commission: money(orders.commissionAmount),
        merchantNet: money(orders.merchantNet),
      })
      .from(orders)
      .where(and(eq(orders.status, 'COMPLETED'), gte(orders.completedAt, from), lt(orders.completedAt, to)))
      .groupBy(orders.restaurantId),
    d
      .select({ restaurantId: orders.restaurantId, sales: money(orders.total), commission: money(orders.commissionAmount) })
      .from(orders)
      .where(eq(orders.status, 'COMPLETED'))
      .groupBy(orders.restaurantId),
    d.select({ restaurantId: settlements.restaurantId, paid: money(settlements.amountPaid) }).from(settlements).groupBy(settlements.restaurantId),
    refundTotals(d, { from, to }),
    refundTotals(d, null),
  ]);
  return list.map((r) => {
    const p = period.find((x) => x.restaurantId === r.id);
    const a = allTime.find((x) => x.restaurantId === r.id);
    const s = paid.find((x) => x.restaurantId === r.id);
    const pr = periodRefunds.find((x) => x.restaurantId === r.id) ?? { amount: 0, commissionReversed: 0 };
    const ar = allRefunds.find((x) => x.restaurantId === r.id) ?? { amount: 0, commissionReversed: 0 };
    const commission = Number(a?.commission ?? 0) - ar.commissionReversed;
    const paidAmount = Number(s?.paid ?? 0);
    return {
      restaurantId: r.id,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      commissionBps: r.commissionBps,
      period: {
        completed: Number(p?.completed ?? 0),
        sales: Number(p?.sales ?? 0) - pr.amount,
        refunds: pr.amount,
        discounts: Number(p?.discounts ?? 0),
        commission: Number(p?.commission ?? 0) - pr.commissionReversed,
        merchantNet: Number(p?.merchantNet ?? 0) - (pr.amount - pr.commissionReversed),
      },
      allTime: { sales: Number(a?.sales ?? 0) - ar.amount, commission, paid: paidAmount, outstanding: commission - paidAmount },
    };
  });
}

/** Which QR poster (utm_source) brought orders. */
export async function salesBySource(d: Db, from: Date, to: Date, restaurantId?: string) {
  const rows = await d
    .select({
      source: sql<string>`coalesce(${orders.source}, '(direct)')`,
      orders: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${orders.status} = 'COMPLETED')::int`,
      sales: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} = 'COMPLETED'), 0)::float8`,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, from), lt(orders.createdAt, to), ...(restaurantId ? [eq(orders.restaurantId, restaurantId)] : [])))
    .groupBy(sql`1`)
    .orderBy(desc(sql`2`));
  return rows.map((r) => ({ source: r.source, orders: Number(r.orders), completed: Number(r.completed), sales: Number(r.sales) }));
}

/** Per-courier hand-over summary for a day: who delivered what, and how much cash they should hand in. */
export async function courierSummary(d: Db, restaurantId: string, from: Date, to: Date) {
  const rows = await d
    .select({
      userId: orders.assignedToUserId,
      name: users.name,
      onTheWay: sql<number>`count(*) filter (where ${orders.status} in ('OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE'))::int`,
      delivered: sql<number>`count(*) filter (where ${orders.status} = 'COMPLETED')::int`,
      cashCollected: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} = 'COMPLETED' and ${orders.paymentMethod} = 'CASH'), 0)::float8`,
      cashPending: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} in ('OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE') and ${orders.paymentMethod} = 'CASH'), 0)::float8`,
    })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.assignedToUserId))
    .where(and(eq(orders.restaurantId, restaurantId), gte(orders.createdAt, from), lt(orders.createdAt, to), sql`${orders.assignedToUserId} is not null`))
    .groupBy(orders.assignedToUserId, users.name);
  return rows.map((r) => ({ userId: r.userId!, name: r.name ?? '—', onTheWay: Number(r.onTheWay), delivered: Number(r.delivered), cashCollected: Number(r.cashCollected), cashPending: Number(r.cashPending) }));
}
