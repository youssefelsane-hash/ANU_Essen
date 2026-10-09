import { and, eq, lte, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { db, isUniqueViolation } from '../db';
import { deliveryPoints, orderEvents, orderItems, orders, paymentAttachments, payments, products, restaurants, storeCounters, users } from '../db/schema';
import { loadAuthz } from '../auth/authz';
import { AppError } from '../errors';
import { log } from '../log';
import {
  actorMayPerform,
  nextStatus,
  paymentStatusAfter,
  STATUS_TIMESTAMP_FIELD,
  type ActorType,
  type OrderAction,
  type OrderStatus,
} from '../../lib/domain/order-machine';
import { hasPermission, type AuthzSnapshot } from '../../lib/domain/permissions';
import { computeEta } from '../../lib/domain/queue';
import { CUSTOMER_CANCEL_GRACE_MINUTES } from '../../lib/domain/risk';
import { audit } from './audit';
import { getActiveLoad, getQueueConfig } from './store';

export interface ActionActor {
  type: ActorType;
  userId?: string | null;
  label: string;
  auth?: AuthzSnapshot | null;
  deviceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ApplyActionInput {
  orderId: string;
  action: OrderAction;
  actor: ActionActor;
  /** Client-generated UUID of the action — makes retries idempotent. */
  clientEventId?: string | null;
  /** When the action actually happened on the device (may be in the past for offline actions). */
  occurredAt?: Date | null;
  payload?: { reason?: string | null; reference?: string | null };
  attachment?: { contentType: string; data: Buffer } | null;
  /** Reject if the order belongs to another restaurant. */
  restaurantId?: string;
  /** A background job must not act on a status that changed after its initial read. */
  expectedStatus?: OrderStatus;
  expectedVersion?: number;
  now?: Date;
}

export interface ApplyActionResult {
  result: 'applied' | 'duplicate';
  orderId: string;
  restaurantId: string;
  status: OrderStatus;
}

const AUDITED_ACTIONS: ReadonlySet<OrderAction> = new Set(['ACCEPT', 'VERIFY_PAYMENT', 'REJECT_PAYMENT', 'CANCEL', 'COMPLETE']);

function duplicateResult(order: typeof orders.$inferSelect, event: typeof orderEvents.$inferSelect, input: ApplyActionInput): ApplyActionResult {
  if (event.orderId !== order.id || event.action !== input.action || event.restaurantId !== order.restaurantId ||
      (event.data?.reason ?? null) !== (input.payload?.reason?.trim() || null) ||
      (event.data?.reference ?? null) !== (input.payload?.reference?.trim() || null)) {
    throw new AppError('IDEMPOTENCY_MISMATCH', 'مفتاح الإجراء مستخدم لطلب أو بيانات مختلفة');
  }
  if (event.actorType !== input.actor.type || event.actorUserId !== (input.actor.userId ?? null) ||
      !actorMayPerform(input.actor.type, input.action, event.fromStatus ?? order.status, (p) =>
        input.actor.auth ? hasPermission(input.actor.auth, p, order.restaurantId) : false, order.fulfillment)) {
    throw new AppError('FORBIDDEN', 'Not allowed to replay this action');
  }
  return { result: 'duplicate', orderId: order.id, restaurantId: order.restaurantId, status: order.status };
}

/**
 * The only way an order changes status. Validates the transition with the shared state machine,
 * checks the actor's permission, recalculates the server-authoritative ETA, appends an order event
 * (allocating the next sync cursor) and writes the audit log — all in one transaction.
 */
export async function applyOrderAction(input: ApplyActionInput): Promise<ApplyActionResult> {
  const now = input.now ?? new Date();
  try {
    return await db().transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for('update');
      if (!order || (input.restaurantId && order.restaurantId !== input.restaurantId)) {
        throw new AppError('NOT_FOUND', 'Order not found');
      }

      let authorization = input.actor.auth;
      if (input.action === 'OUT_FOR_DELIVERY' && input.actor.type === 'USER') {
        if (!input.actor.userId) throw new AppError('FORBIDDEN');
        // Shares the assignment-management mutex: a claim cannot slip in after a grant removal.
        const [user] = await tx.select().from(users).where(eq(users.id, input.actor.userId)).for('update');
        if (!user?.isActive) throw new AppError('FORBIDDEN');
        authorization = await loadAuthz(tx, { id: user.id, name: user.name, email: user.email });
      }

      if (input.clientEventId) {
        const [dup] = await tx.select().from(orderEvents).where(eq(orderEvents.clientEventId, input.clientEventId));
        if (dup) return duplicateResult(order, dup, { ...input, actor: { ...input.actor, auth: authorization } });
      }

      if ((input.expectedStatus && order.status !== input.expectedStatus) ||
          (input.expectedVersion !== undefined && order.version !== input.expectedVersion)) {
        throw new AppError('INVALID_TRANSITION', 'Order changed since the background job inspected it');
      }

      const next = nextStatus(order.status, input.action, order.fulfillment);
      if (!next) {
        throw new AppError('INVALID_TRANSITION', `Cannot ${input.action} an order that is ${order.status}`, { current: order.status, action: input.action });
      }
      const permitted = actorMayPerform(input.actor.type, input.action, order.status, (p) =>
        authorization ? hasPermission(authorization, p, order.restaurantId) : false,
      order.fulfillment);
      if (!permitted) throw new AppError('FORBIDDEN', 'Not allowed to perform this action');

      // A customer may take back a cash order only moments after it was accepted, before cooking.
      if (input.actor.type === 'CUSTOMER' && input.action === 'CANCEL' && order.status === 'CONFIRMED') {
        const confirmedAt = order.confirmedAt?.getTime() ?? 0;
        if (order.paymentMethod !== 'CASH' || order.channel !== 'ONLINE' || now.getTime() - confirmedAt > CUSTOMER_CANCEL_GRACE_MINUTES * 60_000) {
          throw new AppError('FORBIDDEN', 'المطعم بدأ في طلبك، مينفعش يتلغي من هنا. كلّم المطعم.');
        }
      }

      if (input.action === 'SUBMIT_PAYMENT') {
        const [restaurant] = await tx.select({ timeout: restaurants.unpaidTimeoutMinutes }).from(restaurants).where(eq(restaurants.id, order.restaurantId));
        if (restaurant && restaurant.timeout > 0 && now.getTime() >= order.updatedAt.getTime() + restaurant.timeout * 60_000) {
          throw new AppError('CONFLICT', 'انتهت مهلة الدفع، ابدأ طلبًا جديدًا');
        }
      }

      // Delivery-only staff may finish only deliveries they took.
      if (
        input.actor.type === 'USER' &&
        (input.action === 'MARK_ARRIVED' || input.action === 'COMPLETE') &&
        input.actor.auth &&
        !hasPermission(input.actor.auth, 'orders.view', order.restaurantId) &&
        order.assignedToUserId &&
        order.assignedToUserId !== input.actor.userId
      ) {
        throw new AppError('FORBIDDEN', 'This delivery is assigned to someone else');
      }

      // Offline actions keep their real time, but never before the order existed or in the future.
      let at = input.occurredAt ?? now;
      if (at > now) at = now;
      if (at < order.createdAt) at = order.createdAt;

      // Serialize queue changes before reading the active load. Simultaneous confirmations
      // must include the previously confirmed order in their ETA calculation.
      const [counter] = await tx
        .update(storeCounters)
        .set({ eventSeq: sql`${storeCounters.eventSeq} + 1` })
        .where(eq(storeCounters.restaurantId, order.restaurantId))
        .returning({ eventSeq: storeCounters.eventSeq });
      if (!counter) throw new AppError('INTERNAL', 'Restaurant counters missing');

      const patch: PgUpdateSetSource<typeof orders> = { status: next, updatedAt: now };
      const tsField = STATUS_TIMESTAMP_FIELD[next];
      if (tsField) (patch as Record<string, unknown>)[tsField] = at;

      const eventData: Record<string, unknown> = {};
      const newPaymentStatus = paymentStatusAfter(input.action, order.paymentMethod, order.paymentStatus);
      if (newPaymentStatus) patch.paymentStatus = newPaymentStatus;

      let etaChanged = false;
      const deliveryMinutes = async () => {
        const cfg = await getQueueConfig(tx, order.restaurantId);
        let extra = 0;
        if (order.deliveryPointId) {
          const [dp] = await tx.select({ extra: deliveryPoints.extraMinutes }).from(deliveryPoints).where(eq(deliveryPoints.id, order.deliveryPointId));
          extra = dp?.extra ?? 0;
        }
        // Pickup at the restaurant: no delivery leg, the order is "there" once it is ready.
        if (order.fulfillment === 'PICKUP') return { cfg, extra: 0, minutes: 0 };
        return { cfg, extra, minutes: cfg.deliveryMinutes + extra };
      };

      if (next === 'CONFIRMED') {
        const { cfg, extra } = await deliveryMinutes();
        const { load } = await getActiveLoad(tx, order.restaurantId, order.id);
        const eta = computeEta({ confirmedAt: at, activeLoad: load, orderLoad: order.loadUnits, config: cfg, extraDeliveryMinutes: extra, pickup: order.fulfillment === 'PICKUP' });
        patch.estimatedPrepStartAt = eta.prepStartAt;
        patch.estimatedReadyAt = eta.readyAt;
        patch.estimatedArrivalAt = eta.arrivalAt;
        etaChanged = true;
        eventData.eta = { prepMinutes: eta.prepMinutes, deliveryMinutes: eta.deliveryMinutes, projectedLoad: eta.projectedLoad, arrivalAt: eta.arrivalAt.getTime() };
      } else if (next === 'READY') {
        const { minutes } = await deliveryMinutes();
        patch.estimatedReadyAt = at;
        patch.estimatedArrivalAt = new Date(at.getTime() + minutes * 60_000);
        etaChanged = true;
      } else if (next === 'OUT_FOR_DELIVERY') {
        const { minutes } = await deliveryMinutes();
        patch.estimatedArrivalAt = new Date(at.getTime() + minutes * 60_000);
        patch.assignedToUserId = input.actor.userId ?? null;
        etaChanged = true;
      } else if (next === 'ARRIVED_AT_GATE') {
        patch.estimatedArrivalAt = at;
        etaChanged = true;
      }
      if (etaChanged) patch.etaVersion = sql`${orders.etaVersion} + 1`;

      const reason = input.payload?.reason?.trim() || null;
      if (next === 'CANCELLED') patch.cancelReason = reason ?? (input.actor.type === 'CUSTOMER' ? 'ألغاه العميل' : null);
      if (reason) eventData.reason = reason;

      await tx
        .update(orders)
        .set({ ...patch, version: sql`${orders.version} + 1` })
        .where(eq(orders.id, order.id));

      // A cancelled order gives its units back to tracked products.
      if (next === 'CANCELLED') {
        const items = await tx.select({ productId: orderItems.productId, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, order.id));
        const back = new Map<string, number>();
        for (const it of items) if (it.productId) back.set(it.productId, (back.get(it.productId) ?? 0) + it.quantity);
        for (const [productId, qty] of back) {
          await tx.update(products).set({ stockQty: sql`${products.stockQty} + ${qty}`, updatedAt: now })
            .where(and(eq(products.id, productId), eq(products.trackStock, true)));
        }
      }

      const paymentPatch: Partial<typeof payments.$inferInsert> = { updatedAt: now };
      if (newPaymentStatus) paymentPatch.status = newPaymentStatus;
      if (input.action === 'SUBMIT_PAYMENT') {
        paymentPatch.submittedAt = at;
        paymentPatch.reference = input.payload?.reference?.trim() || null;
        paymentPatch.rejectedReason = null;
        if (paymentPatch.reference) eventData.reference = paymentPatch.reference;
      } else if (input.action === 'VERIFY_PAYMENT') {
        paymentPatch.verifiedAt = at;
        paymentPatch.verifiedByUserId = input.actor.userId ?? null;
      } else if (input.action === 'REJECT_PAYMENT') {
        paymentPatch.rejectedReason = reason;
      }
      if (newPaymentStatus || input.action === 'SUBMIT_PAYMENT') {
        const [payment] = await tx.update(payments).set(paymentPatch).where(eq(payments.orderId, order.id)).returning({ id: payments.id });
        if (payment && input.attachment) {
          await tx.insert(paymentAttachments).values({
            paymentId: payment.id,
            contentType: input.attachment.contentType,
            sizeBytes: input.attachment.data.length,
            data: input.attachment.data,
          });
          eventData.attachment = true;
        }
      }

      await tx.insert(orderEvents).values({
        restaurantId: order.restaurantId,
        orderId: order.id,
        seq: counter.eventSeq,
        type: 'STATUS_CHANGED',
        action: input.action,
        fromStatus: order.status,
        toStatus: next,
        actorType: input.actor.type,
        actorUserId: input.actor.userId ?? null,
        deviceId: input.actor.deviceId ?? null,
        clientEventId: input.clientEventId ?? null,
        data: Object.keys(eventData).length ? eventData : null,
        occurredAt: at,
        recordedAt: now,
      });

      if (input.actor.type !== 'USER' || AUDITED_ACTIONS.has(input.action)) {
        await audit(
          {
            actor: { type: input.actor.type, userId: input.actor.userId, label: input.actor.label },
            action: `order.${input.action.toLowerCase()}`,
            entity: 'order',
            entityId: order.id,
            restaurantId: order.restaurantId,
            before: { status: order.status, paymentStatus: order.paymentStatus },
            after: { status: next, paymentStatus: newPaymentStatus ?? order.paymentStatus, orderNumber: order.orderNumber, reason },
            ip: input.actor.ip,
            userAgent: input.actor.userAgent,
            deviceId: input.actor.deviceId,
          },
          tx,
        );
      }

      return { result: 'applied' as const, orderId: order.id, restaurantId: order.restaurantId, status: next };
    });
  } catch (err) {
    if (input.clientEventId && isUniqueViolation(err, 'order_events_client_event_id_unique')) {
      const [o] = await db().select().from(orders).where(eq(orders.id, input.orderId));
      const [event] = await db().select().from(orderEvents).where(eq(orderEvents.clientEventId, input.clientEventId));
      if (o && event && (!input.restaurantId || o.restaurantId === input.restaurantId)) return duplicateResult(o, event, input);
    }
    throw err;
  }
}

const lastExpiryRun = new Map<string, number>();

/** Cancels InstaPay orders that were never paid within the restaurant's timeout. Throttled per instance. */
export async function expireUnpaidOrders(restaurantId: string, timeoutMinutes: number, now = new Date()) {
  const last = lastExpiryRun.get(restaurantId) ?? 0;
  if (now.getTime() - last < 60_000 || timeoutMinutes <= 0) return 0;
  lastExpiryRun.set(restaurantId, now.getTime());
  const stale = await db()
    .select({ id: orders.id, version: orders.version })
    .from(orders)
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.status, 'AWAITING_PAYMENT'),
        lte(orders.updatedAt, new Date(now.getTime() - timeoutMinutes * 60_000)),
      ),
    )
    .limit(50);
  let cancelled = 0;
  for (const o of stale) {
    try {
      await applyOrderAction({
        orderId: o.id,
        action: 'CANCEL',
        actor: { type: 'SYSTEM', label: 'payment-timeout' },
        expectedStatus: 'AWAITING_PAYMENT',
        expectedVersion: o.version,
        payload: { reason: 'انتهت مهلة الدفع' },
        now,
      });
      cancelled++;
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'INVALID_TRANSITION')) {
        log.warn('expire_unpaid_failed', { orderId: o.id, error: String(err) });
      }
    }
  }
  return cancelled;
}

/** Enforce the payment deadline even when the restaurant tablet is offline. */
export async function expireUnpaidOrder(orderId: string, now = new Date()): Promise<boolean> {
  const [row] = await db().select({ order: orders, timeout: restaurants.unpaidTimeoutMinutes }).from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId)).where(eq(orders.id, orderId));
  if (!row || row.order.status !== 'AWAITING_PAYMENT' || row.timeout <= 0 ||
      now.getTime() < row.order.updatedAt.getTime() + row.timeout * 60_000) return false;
  try {
    await applyOrderAction({ orderId, action: 'CANCEL', expectedStatus: 'AWAITING_PAYMENT', expectedVersion: row.order.version,
      actor: { type: 'SYSTEM', label: 'payment-timeout' }, payload: { reason: 'انتهت مهلة الدفع' }, now });
    return true;
  } catch (err) {
    if (err instanceof AppError && err.code === 'INVALID_TRANSITION') return false;
    throw err;
  }
}

/** Test helper. */
export function resetExpiryThrottle() {
  lastExpiryRun.clear();
}
