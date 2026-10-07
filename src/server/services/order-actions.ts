import { and, eq, lt, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { db, isUniqueViolation } from '../db';
import { deliveryPoints, orderEvents, orders, paymentAttachments, payments, storeCounters } from '../db/schema';
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
  now?: Date;
}

export interface ApplyActionResult {
  result: 'applied' | 'duplicate';
  orderId: string;
  restaurantId: string;
  status: OrderStatus;
}

const AUDITED_ACTIONS: ReadonlySet<OrderAction> = new Set(['ACCEPT', 'VERIFY_PAYMENT', 'REJECT_PAYMENT', 'CANCEL', 'COMPLETE']);

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

      if (input.clientEventId) {
        const [dup] = await tx.select({ id: orderEvents.id }).from(orderEvents).where(eq(orderEvents.clientEventId, input.clientEventId));
        if (dup) return { result: 'duplicate' as const, orderId: order.id, restaurantId: order.restaurantId, status: order.status };
      }

      const next = nextStatus(order.status, input.action);
      if (!next) {
        throw new AppError('INVALID_TRANSITION', `Cannot ${input.action} an order that is ${order.status}`, { current: order.status, action: input.action });
      }
      const permitted = actorMayPerform(input.actor.type, input.action, order.status, (p) =>
        input.actor.auth ? hasPermission(input.actor.auth, p, order.restaurantId) : false,
      );
      if (!permitted) throw new AppError('FORBIDDEN', 'Not allowed to perform this action');

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
        return { cfg, extra, minutes: cfg.deliveryMinutes + extra };
      };

      if (next === 'CONFIRMED') {
        const { cfg, extra } = await deliveryMinutes();
        const { load } = await getActiveLoad(tx, order.restaurantId, order.id);
        const eta = computeEta({ confirmedAt: at, activeLoad: load, orderLoad: order.loadUnits, config: cfg, extraDeliveryMinutes: extra });
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

      const [counter] = await tx
        .update(storeCounters)
        .set({ eventSeq: sql`${storeCounters.eventSeq} + 1` })
        .where(eq(storeCounters.restaurantId, order.restaurantId))
        .returning({ eventSeq: storeCounters.eventSeq });

      await tx
        .update(orders)
        .set({ ...patch, version: sql`${orders.version} + 1` })
        .where(eq(orders.id, order.id));

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
    if (input.clientEventId && isUniqueViolation(err)) {
      const [o] = await db().select({ id: orders.id, restaurantId: orders.restaurantId, status: orders.status }).from(orders).where(eq(orders.id, input.orderId));
      if (o) return { result: 'duplicate', orderId: o.id, restaurantId: o.restaurantId, status: o.status };
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
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.status, 'AWAITING_PAYMENT'),
        lt(orders.createdAt, new Date(now.getTime() - timeoutMinutes * 60_000)),
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
        payload: { reason: 'انتهت مهلة الدفع' },
        now,
      });
      cancelled++;
    } catch (err) {
      log.warn('expire_unpaid_failed', { orderId: o.id, error: String(err) });
    }
  }
  return cancelled;
}

/** Test helper. */
export function resetExpiryThrottle() {
  lastExpiryRun.clear();
}
