import { and, asc, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { db, isUniqueViolation, type Db } from '../db';
import { orderEvents, orders, payments, refunds, restaurants, storeCounters } from '../db/schema';
import { AppError } from '../errors';
import { hasPermission, type AuthzSnapshot } from '../../lib/domain/permissions';
import type { PaymentMethod } from '../../lib/domain/order-machine';
import { audit } from './audit';

/** How long after an order finished (completed / cancelled) the customer can still ask for a refund. */
export const REFUND_REQUEST_WINDOW_HOURS = 72;

type OrderRow = typeof orders.$inferSelect;

export interface StaffActor {
  userId: string;
  name: string;
  auth: AuthzSnapshot;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Money reached the restaurant: InstaPay verified, cash collected at hand-over, or a transfer the
 * customer sent for an order that was cancelled before anyone verified it.
 */
export function hasReceivedPayment(o: Pick<OrderRow, 'paymentStatus' | 'status'>): boolean {
  return o.paymentStatus === 'PAYMENT_VERIFIED' || o.paymentStatus === 'PARTIALLY_REFUNDED' || (o.paymentStatus === 'PAYMENT_SUBMITTED' && o.status === 'CANCELLED');
}

export function refundableAmount(o: Pick<OrderRow, 'total' | 'refundedTotal' | 'paymentStatus' | 'status'>): number {
  return hasReceivedPayment(o) ? Math.max(0, o.total - o.refundedTotal) : 0;
}

/** A customer may ask once the order is finished, within the request window. */
export function canCustomerRequestRefund(o: OrderRow, now = new Date()): boolean {
  if (refundableAmount(o) <= 0) return false;
  if (o.status !== 'COMPLETED' && o.status !== 'CANCELLED') return false;
  const finishedAt = o.completedAt ?? o.cancelledAt ?? o.updatedAt;
  return now.getTime() - finishedAt.getTime() <= REFUND_REQUEST_WINDOW_HOURS * 3_600_000;
}

/** Platform commission given back in proportion to the refunded share of the order. */
export function commissionReversedFor(o: Pick<OrderRow, 'total' | 'commissionAmount'>, amount: number): number {
  return o.total > 0 ? Math.round((o.commissionAmount * amount) / o.total) : 0;
}

async function nextSeq(tx: Db, restaurantId: string): Promise<number> {
  const [counter] = await tx
    .update(storeCounters)
    .set({ eventSeq: sql`${storeCounters.eventSeq} + 1` })
    .where(eq(storeCounters.restaurantId, restaurantId))
    .returning({ eventSeq: storeCounters.eventSeq });
  if (!counter) throw new AppError('INTERNAL', 'Restaurant counters missing');
  return counter.eventSeq;
}

async function lockOrder(tx: Db, orderId: string, restaurantId?: string): Promise<OrderRow> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!order || (restaurantId && order.restaurantId !== restaurantId)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  return order;
}

export interface RecordRefundInput {
  orderId: string;
  /** Reject if the order belongs to another restaurant. */
  restaurantId?: string;
  /** Piasters. Defaults to everything still refundable. */
  amount?: number;
  method: PaymentMethod;
  reason?: string | null;
  reference?: string | null;
  actor: StaffActor;
  now?: Date;
}

/**
 * Staff records money given back to the customer (full or partial). If the customer had an open
 * request, that request is the one completed. Updates the order + payment, reverses the matching
 * share of platform commission, notifies devices through the order event log, and is audited.
 */
export async function recordRefund(input: RecordRefundInput) {
  const now = input.now ?? new Date();
  return db().transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId, input.restaurantId);
    if (!hasPermission(input.actor.auth, 'payments.refund', order.restaurantId)) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
    const remaining = refundableAmount(order);
    if (remaining <= 0) throw new AppError('CONFLICT', 'الطلب ده مفيهوش مبلغ مدفوع يترجع');
    const amount = input.amount ?? remaining;
    if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) {
      throw new AppError('VALIDATION', 'مبلغ الاسترداد لازم يكون أكبر من صفر ومش أكتر من المتبقي', { remaining });
    }
    const [prior] = await tx.select({ reversed: sql<number>`coalesce(sum(${refunds.commissionReversed}), 0)::int` })
      .from(refunds).where(and(eq(refunds.orderId, order.id), eq(refunds.status, 'COMPLETED')));
    const alreadyReversed = Number(prior?.reversed ?? 0);
    // Cumulative allocation prevents repeated penny refunds from creating or losing fee revenue.
    // Existing refund snapshots stay untouched; the last refund reverses only the actual remainder.
    const targetReversed = commissionReversedFor(order, order.refundedTotal + amount);
    const commissionReversed = Math.max(0, Math.min(amount, order.commissionAmount - alreadyReversed, targetReversed - alreadyReversed));
    const values = {
      status: 'COMPLETED' as const,
      amount,
      method: input.method,
      reference: input.reference?.trim() || null,
      decisionNote: input.reason?.trim() || null,
      commissionReversed,
      decidedByUserId: input.actor.userId,
      decidedAt: now,
      updatedAt: now,
    };
    const [open] = await tx.select({ id: refunds.id }).from(refunds).where(and(eq(refunds.orderId, order.id), eq(refunds.status, 'REQUESTED')));
    let refundId: string;
    if (open) {
      await tx.update(refunds).set(values).where(eq(refunds.id, open.id));
      refundId = open.id;
    } else {
      const [row] = await tx
        .insert(refunds)
        .values({ ...values, restaurantId: order.restaurantId, orderId: order.id, reason: input.reason?.trim() || null, createdByUserId: input.actor.userId, createdAt: now })
        .returning({ id: refunds.id });
      refundId = row.id;
    }

    const refundedTotal = order.refundedTotal + amount;
    const paymentStatus = refundedTotal >= order.total ? ('REFUNDED' as const) : ('PARTIALLY_REFUNDED' as const);
    await tx.update(orders).set({ refundedTotal, paymentStatus, updatedAt: now, version: sql`${orders.version} + 1` }).where(eq(orders.id, order.id));
    await tx.update(payments).set({ status: paymentStatus, updatedAt: now }).where(eq(payments.orderId, order.id));
    await tx.insert(orderEvents).values({
      restaurantId: order.restaurantId,
      orderId: order.id,
      seq: await nextSeq(tx, order.restaurantId),
      type: 'REFUNDED',
      actorType: 'USER',
      actorUserId: input.actor.userId,
      data: { refundId, amount, method: input.method, refundedTotal, reason: input.reason?.trim() || null },
      occurredAt: now,
      recordedAt: now,
    });
    await audit(
      {
        actor: { type: 'USER', userId: input.actor.userId, label: input.actor.name },
        action: 'order.refund',
        entity: 'order',
        entityId: order.id,
        restaurantId: order.restaurantId,
        before: { paymentStatus: order.paymentStatus, refundedTotal: order.refundedTotal },
        after: { paymentStatus, refundedTotal, amount, method: input.method, orderNumber: order.orderNumber, reference: values.reference, commissionReversed },
        ip: input.actor.ip,
        userAgent: input.actor.userAgent,
      },
      tx,
    );
    return { refundId, amount, refundedTotal, paymentStatus };
  });
}

/** Staff declines a customer's refund request (with a note the customer sees). */
export async function rejectRefundRequest(input: { refundId: string; restaurantId?: string; note: string; actor: StaffActor; now?: Date }) {
  const now = input.now ?? new Date();
  const note = input.note.trim();
  if (note.length < 2) throw new AppError('VALIDATION', 'اكتب سبب الرفض عشان العميل يعرفه');
  return db().transaction(async (tx) => {
    const [request] = await tx.select().from(refunds).where(eq(refunds.id, input.refundId)).for('update');
    if (!request || (input.restaurantId && request.restaurantId !== input.restaurantId)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
    if (!hasPermission(input.actor.auth, 'payments.refund', request.restaurantId)) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
    if (request.status !== 'REQUESTED') throw new AppError('CONFLICT', 'الطلب ده اتراجع بالفعل');
    await tx.update(refunds).set({ status: 'REJECTED', decisionNote: note, decidedByUserId: input.actor.userId, decidedAt: now, updatedAt: now }).where(eq(refunds.id, request.id));
    // Customers poll by order version; make the decision visible.
    await tx.update(orders).set({ version: sql`${orders.version} + 1`, updatedAt: now }).where(eq(orders.id, request.orderId));
    await tx.insert(orderEvents).values({
      restaurantId: request.restaurantId,
      orderId: request.orderId,
      seq: await nextSeq(tx, request.restaurantId),
      type: 'REFUND_REJECTED',
      actorType: 'USER',
      actorUserId: input.actor.userId,
      data: { refundId: request.id, reason: note },
      occurredAt: now,
      recordedAt: now,
    });
    await audit(
      {
        actor: { type: 'USER', userId: input.actor.userId, label: input.actor.name },
        action: 'order.refund_rejected',
        entity: 'order',
        entityId: request.orderId,
        restaurantId: request.restaurantId,
        after: { refundId: request.id, note },
        ip: input.actor.ip,
        userAgent: input.actor.userAgent,
      },
      tx,
    );
  });
}

/** Customer asks for their money back from the tracking page (bearer: the tracking token). */
export async function requestRefundByCustomer(input: { token: string; reason: string; payoutDetails?: string | null; now?: Date; ip?: string | null; userAgent?: string | null }) {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AppError('VALIDATION', 'اكتب سبب طلب الاسترجاع');
  const [found] = await db().select({ id: orders.id }).from(orders).where(eq(orders.trackingToken, input.token));
  if (!found) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  try {
    return await db().transaction(async (tx) => {
      const order = await lockOrder(tx, found.id);
      if (!canCustomerRequestRefund(order, now)) throw new AppError('CONFLICT', 'الطلب ده مش متاح لطلب استرجاع');
      const [open] = await tx.select({ id: refunds.id }).from(refunds).where(and(eq(refunds.orderId, order.id), eq(refunds.status, 'REQUESTED')));
      if (open) throw new AppError('CONFLICT', 'طلب الاسترجاع موجود بالفعل وبيتراجع');
      const [row] = await tx
        .insert(refunds)
        .values({
          restaurantId: order.restaurantId,
          orderId: order.id,
          status: 'REQUESTED',
          amount: refundableAmount(order),
          reason,
          payoutDetails: input.payoutDetails?.trim() || null,
          requestedByCustomer: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: refunds.id });
      await tx.update(orders).set({ version: sql`${orders.version} + 1` }).where(eq(orders.id, order.id));
      await tx.insert(orderEvents).values({
        restaurantId: order.restaurantId,
        orderId: order.id,
        seq: await nextSeq(tx, order.restaurantId),
        type: 'REFUND_REQUESTED',
        actorType: 'CUSTOMER',
        data: { refundId: row.id, reason },
        occurredAt: now,
        recordedAt: now,
      });
      await audit(
        { actor: { type: 'CUSTOMER', label: 'customer' }, action: 'order.refund_requested', entity: 'order', entityId: order.id, restaurantId: order.restaurantId, after: { refundId: row.id, reason }, ip: input.ip, userAgent: input.userAgent },
        tx,
      );
      return { refundId: row.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'refunds_one_open_request_uq')) throw new AppError('CONFLICT', 'طلب الاسترجاع موجود بالفعل وبيتراجع');
    throw err;
  }
}

export interface RefundQueueRow {
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  restaurantNameAr: string;
  restaurantNameEn: string;
  customerName: string;
  total: number;
  refundedTotal: number;
  paymentMethod: PaymentMethod;
  orderStatus: OrderRow['status'];
  refundId: string | null;
  refundStatus: 'REQUESTED' | 'COMPLETED' | 'REJECTED' | null;
  amount: number;
  reason: string | null;
  at: Date;
}

/**
 * What needs attention: open customer requests, cancelled orders whose money was received but not
 * given back yet, and the recent refund history. `restaurantId` null = every restaurant (platform).
 */
export async function refundQueue(d: Db, restaurantId: string | null, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const scopeRefund = restaurantId ? [eq(refunds.restaurantId, restaurantId)] : [];
  const scopeOrder = restaurantId ? [eq(orders.restaurantId, restaurantId)] : [];
  const refundCols = {
    orderId: orders.id,
    orderNumber: orders.orderNumber,
    restaurantId: orders.restaurantId,
    restaurantNameAr: restaurants.nameAr,
    restaurantNameEn: restaurants.nameEn,
    customerName: orders.customerName,
    total: orders.total,
    refundedTotal: orders.refundedTotal,
    paymentMethod: orders.paymentMethod,
    orderStatus: orders.status,
    refundId: refunds.id,
    refundStatus: refunds.status,
    amount: refunds.amount,
    reason: refunds.reason,
    createdAt: refunds.createdAt,
    decidedAt: refunds.decidedAt,
  };
  const [openRows, historyRows, unpaidBack] = await Promise.all([
    d.select(refundCols).from(refunds).innerJoin(orders, eq(orders.id, refunds.orderId)).innerJoin(restaurants, eq(restaurants.id, refunds.restaurantId))
      .where(and(eq(refunds.status, 'REQUESTED'), ...scopeRefund)).orderBy(asc(refunds.createdAt)).limit(200),
    d.select(refundCols).from(refunds).innerJoin(orders, eq(orders.id, refunds.orderId)).innerJoin(restaurants, eq(restaurants.id, refunds.restaurantId))
      .where(and(ne(refunds.status, 'REQUESTED'), gte(refunds.decidedAt, since), ...scopeRefund)).orderBy(desc(refunds.decidedAt)).limit(100),
    d.select({
      orderId: orders.id, orderNumber: orders.orderNumber, restaurantId: orders.restaurantId, restaurantNameAr: restaurants.nameAr, restaurantNameEn: restaurants.nameEn,
      customerName: orders.customerName, total: orders.total, refundedTotal: orders.refundedTotal, paymentMethod: orders.paymentMethod, orderStatus: orders.status, cancelledAt: orders.cancelledAt, cancelReason: orders.cancelReason,
    }).from(orders).innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
      .where(and(
        eq(orders.status, 'CANCELLED'),
        inArray(orders.paymentStatus, ['PAYMENT_VERIFIED', 'PARTIALLY_REFUNDED', 'PAYMENT_SUBMITTED']),
        gte(orders.cancelledAt, since),
        sql`not exists (select 1 from ${refunds} where ${refunds.orderId} = ${orders.id} and ${refunds.status} = 'REQUESTED')`,
        ...scopeOrder,
      )).orderBy(asc(orders.cancelledAt)).limit(200),
  ]);
  const fromRefund = (r: (typeof openRows)[number]): RefundQueueRow => ({ ...r, at: r.decidedAt ?? r.createdAt });
  return {
    open: openRows.map(fromRefund),
    cancelledPaid: unpaidBack.map((o): RefundQueueRow => ({ ...o, refundId: null, refundStatus: null, amount: o.total - o.refundedTotal, reason: o.cancelReason, at: o.cancelledAt ?? since })),
    history: historyRows.map(fromRefund),
  };
}

export async function openRefundRequestCount(d: Db, restaurantId: string): Promise<number> {
  const [row] = await d.select({ n: sql<number>`count(*)::int` }).from(refunds).where(and(eq(refunds.restaurantId, restaurantId), eq(refunds.status, 'REQUESTED')));
  return Number(row?.n ?? 0);
}
