import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db';
import { courierCashEntries, orders, refunds, restaurants, roles, settlements, userRoles, users } from '../db/schema';
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

/** Restaurant dashboards receive operational sales figures only. */
export async function merchantPeriodStats(d: Db, from: Date, to: Date, restaurantId: string): Promise<Omit<PeriodStats, 'commission' | 'merchantNet'>> {
  const { commission: _commission, merchantNet: _merchantNet, ...stats } = await periodStats(d, from, to, restaurantId);
  return stats;
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
  period: { completed: number; sales: number; refunds: number; discounts: number; commission: number; merchantNet: number; serviceFees: number; deliveryFees: number };
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
        serviceFees: money(orders.serviceFee),
        deliveryFees: money(orders.platformDeliveryFee),
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
        serviceFees: Number(p?.serviceFees ?? 0),
        deliveryFees: Number(p?.deliveryFees ?? 0),
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

/**
 * Cash is a physical liability, separate from restaurant/platform revenue and customer refunds.
 * A refund recorded by the restaurant does not mean the courier paid it from their own cash bag.
 * `period` changes collection/refund activity only; outstanding always covers the complete ledger.
 * Internal query: callers must enforce the viewer's restaurant/courier scope.
 */
export async function courierAccounting(d: Db, restaurantId?: string, courierUserId?: string, period?: { from: Date; to: Date }) {
  const orderScope = [
    eq(orders.fulfillment, 'DELIVERY'),
    sql`${orders.assignedToUserId} is not null`,
    ...(restaurantId ? [eq(orders.restaurantId, restaurantId)] : []),
    ...(courierUserId ? [eq(orders.assignedToUserId, courierUserId)] : []),
  ];
  const completedPeriod = period ? and(gte(orders.completedAt, period.from), lt(orders.completedAt, period.to))! : sql`true`;
  const refundPeriod = period ? [gte(refunds.decidedAt, period.from), lt(refunds.decidedAt, period.to)] : [];
  const [rows, cashRows, refundRows, grants] = await Promise.all([
    d
    .select({
      restaurantId: orders.restaurantId,
      restaurantNameAr: restaurants.nameAr,
      restaurantNameEn: restaurants.nameEn,
      userId: orders.assignedToUserId,
      name: users.name,
      onTheWay: sql<number>`count(*) filter (where ${orders.status} in ('OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE'))::int`,
      delivered: sql<number>`count(*) filter (where ${orders.status} = 'COMPLETED' and ${completedPeriod})::int`,
      cashCollected: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} = 'COMPLETED' and ${orders.paymentMethod} = 'CASH' and ${completedPeriod}), 0)::float8`,
      cashCollectedAllTime: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} = 'COMPLETED' and ${orders.paymentMethod} = 'CASH'), 0)::float8`,
      merchantShare: sql<number>`coalesce(sum(${orders.merchantNet}) filter (where ${orders.status} = 'COMPLETED' and ${orders.paymentMethod} = 'CASH' and ${completedPeriod}), 0)::float8`,
      platformShare: sql<number>`coalesce(sum(${orders.commissionAmount}) filter (where ${orders.status} = 'COMPLETED' and ${orders.paymentMethod} = 'CASH' and ${completedPeriod}), 0)::float8`,
      cashPending: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} in ('OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE') and ${orders.paymentMethod} = 'CASH'), 0)::float8`,
    })
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .leftJoin(users, eq(users.id, orders.assignedToUserId))
    .where(and(...orderScope))
    .groupBy(orders.restaurantId, restaurants.nameAr, restaurants.nameEn, orders.assignedToUserId, users.name),
    d.select({
      restaurantId: courierCashEntries.restaurantId,
      userId: courierCashEntries.courierUserId,
      restaurantNameAr: restaurants.nameAr,
      restaurantNameEn: restaurants.nameEn,
      name: users.name,
      handedIn: sql<number>`coalesce(sum(case when ${courierCashEntries.entryKind} = 'HAND_IN' then ${courierCashEntries.amount} else -${courierCashEntries.amount} end), 0)::float8`,
    }).from(courierCashEntries)
      .innerJoin(restaurants, eq(restaurants.id, courierCashEntries.restaurantId))
      .innerJoin(users, eq(users.id, courierCashEntries.courierUserId))
      .where(and(
        ...(restaurantId ? [eq(courierCashEntries.restaurantId, restaurantId)] : []),
        ...(courierUserId ? [eq(courierCashEntries.courierUserId, courierUserId)] : []),
      ))
      .groupBy(courierCashEntries.restaurantId, courierCashEntries.courierUserId, restaurants.nameAr, restaurants.nameEn, users.name),
    d.select({
      restaurantId: orders.restaurantId, userId: orders.assignedToUserId,
      amount: sql<number>`coalesce(sum(${refunds.amount}), 0)::float8`,
    }).from(refunds).innerJoin(orders, eq(orders.id, refunds.orderId))
      .where(and(...orderScope, eq(orders.status, 'COMPLETED'), eq(orders.paymentMethod, 'CASH'), eq(refunds.status, 'COMPLETED'), ...refundPeriod))
      .groupBy(orders.restaurantId, orders.assignedToUserId),
    d.select({ restaurantId: userRoles.restaurantId, userId: users.id, name: users.name, restaurantNameAr: restaurants.nameAr, restaurantNameEn: restaurants.nameEn })
      .from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).innerJoin(users, eq(users.id, userRoles.userId)).innerJoin(restaurants, eq(restaurants.id, userRoles.restaurantId))
      .where(and(eq(roles.key, 'DELIVERY_STAFF'),
        ...(restaurantId ? [eq(userRoles.restaurantId, restaurantId)] : []),
        ...(courierUserId ? [eq(userRoles.userId, courierUserId)] : []),
      )),
  ]);
  const pairs = new Map<string, { restaurantId: string; userId: string; name: string; restaurantNameAr: string; restaurantNameEn: string }>();
  for (const r of [...grants, ...cashRows, ...rows]) {
    if (r.restaurantId && r.userId) pairs.set(`${r.restaurantId}:${r.userId}`, { ...r, restaurantId: r.restaurantId, userId: r.userId, name: r.name ?? '—' });
  }
  return [...pairs.values()].map((pair) => {
    const r = rows.find((x) => x.restaurantId === pair.restaurantId && x.userId === pair.userId);
    const handedIn = Number(cashRows.find((x) => x.restaurantId === pair.restaurantId && x.userId === pair.userId)?.handedIn ?? 0);
    const cashRefunds = Number(refundRows.find((x) => x.restaurantId === pair.restaurantId && x.userId === pair.userId)?.amount ?? 0);
    const cashCollectedAllTime = Number(r?.cashCollectedAllTime ?? 0);
    return {
      ...pair,
      onTheWay: Number(r?.onTheWay ?? 0), delivered: Number(r?.delivered ?? 0),
      cashCollected: Number(r?.cashCollected ?? 0), cashCollectedAllTime,
      cashPending: Number(r?.cashPending ?? 0), merchantShare: Number(r?.merchantShare ?? 0), platformShare: Number(r?.platformShare ?? 0),
      cashRefunds, handedIn, outstanding: cashCollectedAllTime - handedIn,
    };
  }).sort((a, b) => a.restaurantNameEn.localeCompare(b.restaurantNameEn) || a.name.localeCompare(b.name));
}

/** Collections belong to the day completed, not the day the order was created. */
export async function courierSummary(d: Db, restaurantId: string, from: Date, to: Date) {
  const balances = await courierAccounting(d, restaurantId, undefined, { from, to });
  // This report powers the restaurant dashboard; the platform share is kept
  // exclusively in platform-finance reports.
  return balances.map(({ platformShare: _platformShare, merchantShare: _merchantShare, ...balance }) => balance);
}

export interface DayCloseRow {
  restaurantId: string;
  nameAr: string;
  nameEn: string;
  ordersCreated: number;
  completed: number;
  cancelled: number;
  noShows: number;
  /** Completed in the day, by how the customer paid. */
  cashSales: number;
  instapaySales: number;
  counterSales: number;
  refunds: number;
  /** InstaPay transfers still waiting for a staff check (right now). */
  pendingTransfers: number;
  /** Orders created in the day that are still not finished (right now). */
  stillOpen: number;
  /** Cash couriers still hold for this restaurant (whole ledger, right now). */
  courierCashOutstanding: number;
  /** Platform share of the day's completed orders, minus what refunds gave back. */
  platformShare: number;
}

/**
 * End-of-day close: one row per restaurant with what should be in the drawer / InstaPay account,
 * what went back to customers, what couriers still hold and what the platform is owed.
 * Internal: callers enforce the viewer's scope (one restaurant, or platform finance).
 */
export async function dailyClose(d: Db, from: Date, to: Date, restaurantId?: string): Promise<DayCloseRow[]> {
  const scope = restaurantId ? [eq(orders.restaurantId, restaurantId)] : [];
  const [list, created, done, refunded, live, couriers] = await Promise.all([
    d.select({ id: restaurants.id, nameAr: restaurants.nameAr, nameEn: restaurants.nameEn }).from(restaurants)
      .where(restaurantId ? eq(restaurants.id, restaurantId) : undefined).orderBy(asc(restaurants.nameAr)),
    d.select({
      restaurantId: orders.restaurantId,
      n: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) filter (where ${orders.status} = 'CANCELLED')::int`,
      noShows: sql<number>`count(*) filter (where ${orders.cancelReason} = 'العميل ما استلمش الطلب')::int`,
      stillOpen: sql<number>`count(*) filter (where ${orders.status} not in ('COMPLETED', 'CANCELLED'))::int`,
    }).from(orders).where(and(gte(orders.createdAt, from), lt(orders.createdAt, to), ...scope)).groupBy(orders.restaurantId),
    d.select({
      restaurantId: orders.restaurantId,
      n: sql<number>`count(*)::int`,
      cash: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.paymentMethod} = 'CASH'), 0)::float8`,
      instapay: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.paymentMethod} = 'INSTAPAY'), 0)::float8`,
      counter: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.channel} = 'COUNTER'), 0)::float8`,
      platform: money(orders.commissionAmount),
    }).from(orders).where(and(eq(orders.status, 'COMPLETED'), gte(orders.completedAt, from), lt(orders.completedAt, to), ...scope)).groupBy(orders.restaurantId),
    // Money handed back that day (any order); only completed orders ever counted platform share.
    d.select({
      restaurantId: refunds.restaurantId,
      amount: money(refunds.amount),
      reversed: sql<number>`coalesce(sum(${refunds.commissionReversed}) filter (where ${orders.status} = 'COMPLETED'), 0)::float8`,
    })
      .from(refunds).innerJoin(orders, eq(orders.id, refunds.orderId))
      .where(and(eq(refunds.status, 'COMPLETED'), gte(refunds.decidedAt, from), lt(refunds.decidedAt, to), ...(restaurantId ? [eq(refunds.restaurantId, restaurantId)] : [])))
      .groupBy(refunds.restaurantId),
    d.select({ restaurantId: orders.restaurantId, pending: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.status, 'PAYMENT_REVIEW'), ...scope)).groupBy(orders.restaurantId),
    courierAccounting(d, restaurantId),
  ]);
  return list.map((r) => {
    const c = created.find((x) => x.restaurantId === r.id);
    const k = done.find((x) => x.restaurantId === r.id);
    const f = refunded.find((x) => x.restaurantId === r.id);
    return {
      restaurantId: r.id, nameAr: r.nameAr, nameEn: r.nameEn,
      ordersCreated: Number(c?.n ?? 0), completed: Number(k?.n ?? 0), cancelled: Number(c?.cancelled ?? 0), noShows: Number(c?.noShows ?? 0),
      cashSales: Number(k?.cash ?? 0), instapaySales: Number(k?.instapay ?? 0), counterSales: Number(k?.counter ?? 0),
      refunds: Number(f?.amount ?? 0),
      pendingTransfers: Number(live.find((x) => x.restaurantId === r.id)?.pending ?? 0),
      stillOpen: Number(c?.stillOpen ?? 0),
      courierCashOutstanding: couriers.filter((x) => x.restaurantId === r.id).reduce((s, x) => s + Math.max(0, x.outstanding), 0),
      platformShare: Number(k?.platform ?? 0) - Number(f?.reversed ?? 0),
    };
  });
}
