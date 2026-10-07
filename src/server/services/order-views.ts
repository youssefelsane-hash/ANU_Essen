import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db';
import {
  orderEvents,
  orderItemAddons,
  orderItems,
  orders,
  paymentAttachments,
  payments,
  restaurantPaymentMethods,
  restaurants,
  users,
} from '../db/schema';
import type { OrderSnapshot, SnapshotItem, TimelineEntry, TrackingView } from '../../lib/types';
import { expireUnpaidOrder } from './order-actions';

const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);

function safePaymentLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

async function loadItems(d: Db, orderIds: string[]): Promise<Map<string, SnapshotItem[]>> {
  const itemRows = orderIds.length
    ? await d.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)).orderBy(asc(orderItems.sortOrder))
    : [];
  const itemIds = itemRows.map((i) => i.id);
  const addonRows = itemIds.length ? await d.select().from(orderItemAddons).where(inArray(orderItemAddons.orderItemId, itemIds)) : [];
  const byOrder = new Map<string, SnapshotItem[]>();
  for (const i of itemRows) {
    const list = byOrder.get(i.orderId) ?? [];
    list.push({
      id: i.id,
      nameAr: i.productNameAr,
      nameEn: i.productNameEn,
      variantNameAr: i.variantNameAr,
      variantNameEn: i.variantNameEn,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      addonsPerUnit: i.addonsPerUnit,
      lineTotal: i.lineTotal,
      addons: addonRows.filter((a) => a.orderItemId === i.id).map((a) => ({ nameAr: a.nameAr, nameEn: a.nameEn, price: a.price })),
      note: i.note,
    });
    byOrder.set(i.orderId, list);
  }
  return byOrder;
}

export interface SnapshotOptions {
  includePhone: boolean;
}

/** Full order snapshots for merchant devices (batch-loaded; no N+1). */
export async function loadOrderSnapshots(d: Db, orderIds: string[], opts: SnapshotOptions): Promise<OrderSnapshot[]> {
  const ids = [...new Set(orderIds)];
  if (!ids.length) return [];
  const [orderRows, itemsByOrder, eventRows, paymentRows] = await Promise.all([
    d.select().from(orders).where(inArray(orders.id, ids)),
    loadItems(d, ids),
    d
      .select({
        orderId: orderEvents.orderId,
        type: orderEvents.type,
        action: orderEvents.action,
        toStatus: orderEvents.toStatus,
        occurredAt: orderEvents.occurredAt,
        actorType: orderEvents.actorType,
        actorUserId: orderEvents.actorUserId,
        data: orderEvents.data,
      })
      .from(orderEvents)
      .where(inArray(orderEvents.orderId, ids))
      .orderBy(asc(orderEvents.seq)),
    d.select().from(payments).where(inArray(payments.orderId, ids)),
  ]);
  const paymentIds = paymentRows.map((p) => p.id);
  const attachmentRows = paymentIds.length
    ? await d.select({ paymentId: paymentAttachments.paymentId }).from(paymentAttachments).where(inArray(paymentAttachments.paymentId, paymentIds))
    : [];
  const userIds = [
    ...new Set([...orderRows.map((o) => o.assignedToUserId), ...eventRows.map((e) => e.actorUserId)].filter((x): x is string => !!x)),
  ];
  const userRows = userIds.length ? await d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
  const names = new Map(userRows.map((u) => [u.id, u.name]));

  return orderRows.map((o) => {
    const payment = paymentRows.find((p) => p.orderId === o.id);
    const timeline: TimelineEntry[] = eventRows
      .filter((e) => e.orderId === o.id)
      .map((e) => ({
        type: e.type,
        action: e.action,
        toStatus: e.toStatus,
        occurredAt: e.occurredAt.getTime(),
        actor: e.actorType === 'USER' ? (names.get(e.actorUserId ?? '') ?? 'staff') : e.actorType === 'CUSTOMER' ? 'customer' : 'system',
        note: (e.data?.reason as string | undefined) ?? null,
      }));
    return {
      id: o.id,
      restaurantId: o.restaurantId,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      paymentReference: payment?.reference ?? null,
      paymentRejectedReason: payment?.rejectedReason ?? null,
      hasPaymentAttachment: !!payment && attachmentRows.some((a) => a.paymentId === payment.id),
      customerName: o.customerName,
      customerPhone: opts.includePhone ? o.customerPhone : null,
      customerNote: o.customerNote,
      deliveryPointName: o.deliveryPointName,
      deliveryPointNameEn: o.deliveryPointNameEn,
      fulfillment: o.fulfillment,
      channel: o.channel,
      items: itemsByOrder.get(o.id) ?? [],
      subtotal: o.subtotal,
      discountTotal: o.discountTotal,
      deliveryFee: o.deliveryFee,
      total: o.total,
      currency: o.currency,
      promoCode: o.promoCode,
      loadUnits: o.loadUnits,
      estimatedReadyAt: ms(o.estimatedReadyAt),
      estimatedArrivalAt: ms(o.estimatedArrivalAt),
      createdAt: o.createdAt.getTime(),
      confirmedAt: ms(o.confirmedAt),
      preparingAt: ms(o.preparingAt),
      readyAt: ms(o.readyAt),
      outForDeliveryAt: ms(o.outForDeliveryAt),
      arrivedAt: ms(o.arrivedAt),
      completedAt: ms(o.completedAt),
      cancelledAt: ms(o.cancelledAt),
      cancelReason: o.cancelReason,
      assignedToUserId: o.assignedToUserId,
      assignedToName: o.assignedToUserId ? (names.get(o.assignedToUserId) ?? null) : null,
      timeline,
      version: o.version,
    };
  });
}

/** Public tracking page data — only what the customer needs, looked up by the unguessable token. */
export async function loadTrackingView(d: Db, token: string): Promise<TrackingView | null> {
  let [o] = await d.select().from(orders).where(eq(orders.trackingToken, token));
  if (!o) return null;
  if (o.status === 'AWAITING_PAYMENT' && await expireUnpaidOrder(o.id)) {
    [o] = await d.select().from(orders).where(eq(orders.trackingToken, token));
    if (!o) return null;
  }
  const [[r], itemsByOrder, [payment]] = await Promise.all([
    d.select().from(restaurants).where(eq(restaurants.id, o.restaurantId)),
    loadItems(d, [o.id]),
    d.select().from(payments).where(eq(payments.orderId, o.id)),
  ]);
  if (!r) return null;
  let instapay: TrackingView['instapay'] = null;
  if (o.paymentMethod === 'INSTAPAY') {
    const [m] = await d
      .select()
      .from(restaurantPaymentMethods)
      .where(and(eq(restaurantPaymentMethods.restaurantId, o.restaurantId), eq(restaurantPaymentMethods.method, 'INSTAPAY')));
    const c = m?.config ?? {};
    instapay = {
      accountName: c.accountName ?? null,
      address: c.address ?? null,
      phone: c.phone ?? null,
      link: safePaymentLink(c.link),
      instructions: c.instructions ?? null,
      instructionsEn: c.instructionsEn ?? null,
    };
  }
  return {
    serverTime: Date.now(),
    order: {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      paymentReference: payment?.reference ?? null,
      paymentRejectedReason: payment?.rejectedReason ?? null,
      customerName: o.customerName,
      deliveryPointName: o.deliveryPointName,
      deliveryPointNameEn: o.deliveryPointNameEn,
      fulfillment: o.fulfillment,
      items: itemsByOrder.get(o.id) ?? [],
      subtotal: o.subtotal,
      discountTotal: o.discountTotal,
      deliveryFee: o.deliveryFee,
      total: o.total,
      estimatedReadyAt: ms(o.estimatedReadyAt),
      estimatedArrivalAt: ms(o.estimatedArrivalAt),
      createdAt: o.createdAt.getTime(),
      confirmedAt: ms(o.confirmedAt),
      preparingAt: ms(o.preparingAt),
      readyAt: ms(o.readyAt),
      outForDeliveryAt: ms(o.outForDeliveryAt),
      arrivedAt: ms(o.arrivedAt),
      completedAt: ms(o.completedAt),
      cancelledAt: ms(o.cancelledAt),
      cancelReason: o.cancelReason,
      paymentDeadlineAt: o.status === 'AWAITING_PAYMENT' && r.unpaidTimeoutMinutes > 0 ? o.updatedAt.getTime() + r.unpaidTimeoutMinutes * 60_000 : null,
    },
    restaurant: { nameAr: r.nameAr, nameEn: r.nameEn, phone: r.phone, slug: r.slug, timezone: r.timezone },
    instapay,
  };
}
