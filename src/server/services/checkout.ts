import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db, isUniqueViolation, type Db } from '../db';
import {
  customers,
  deliveryPoints,
  orderEvents,
  orderItemAddons,
  orderItems,
  orders,
  payments,
  promotions,
  promotionUsages,
  restaurantPaymentMethods,
  storeCounters,
} from '../db/schema';
import { AppError } from '../errors';
import { initialStatusFor, type FulfillmentType, type OrderStatus, type PaymentMethod } from '../../lib/domain/order-machine';
import { egp, priceCart, type PricedCart } from '../../lib/domain/pricing';
import { formatOrderNumber, normalizeEgyptianPhone } from '../../lib/domain/misc';
import { hasPermission, type AuthzSnapshot } from '../../lib/domain/permissions';
import { audit } from './audit';
import { acceptsOrders } from '../../lib/domain/store-status';
import { computeEta } from '../../lib/domain/queue';
import type { CreateOrderInput } from '../../lib/validation';
import type { QuoteResponse } from '../../lib/types';
import { loadMenuCatalog, loadPromotionRules } from './menu';
import { closedMessage, getRestaurant, getRestaurantBySlug, getStoreLive, type RestaurantRow } from './store';

async function resolveDeliveryPoint(d: Db, restaurantId: string, id?: string | null) {
  const rows = await d
    .select()
    .from(deliveryPoints)
    .where(and(eq(deliveryPoints.restaurantId, restaurantId), eq(deliveryPoints.isActive, true)))
    .orderBy(asc(deliveryPoints.sortOrder));
  const point = id ? rows.find((p) => p.id === id) : (rows.find((p) => p.isDefault) ?? rows[0]);
  if (!point) throw new AppError('VALIDATION', 'مكان الاستلام غير متاح');
  return point;
}

async function priceFor(d: Db, r: RestaurantRow, input: { items: CreateOrderInput['items']; promoCode?: string | null; deliveryPointId?: string | null }, now: Date) {
  const point = await resolveDeliveryPoint(d, r.id, input.deliveryPointId);
  const [catalog, promos] = await Promise.all([loadMenuCatalog(d, r.id), loadPromotionRules(d, r.id)]);
  const priced = priceCart(input.items, {
    products: catalog.products,
    addonGroups: catalog.addonGroups,
    promotions: promos,
    promoCode: input.promoCode,
    now,
    deliveryFee: point.fulfillmentType === 'PICKUP' ? 0 : point.deliveryFee,
    minOrderAmount: r.minOrderAmount,
    commissionBps: r.commissionBps,
  });
  return { priced, point };
}

function toQuote(priced: PricedCart, etaMinutes: number, fulfillmentType: FulfillmentType): QuoteResponse {
  return {
    fulfillmentType,
    lines: priced.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      nameAr: l.nameAr,
      nameEn: l.nameEn,
      variantNameAr: l.variantNameAr,
      variantNameEn: l.variantNameEn,
      addons: l.addons.map((a) => ({ nameAr: a.nameAr, nameEn: a.nameEn, price: a.price })),
      unitPrice: l.unitPrice,
      addonsPerUnit: l.addonsPerUnit,
      quantity: l.quantity,
      lineTotal: l.lineTotal,
    })),
    subtotal: priced.subtotal,
    discount: priced.discount,
    promotion: priced.promotion ? { name: priced.promotion.name, code: priced.promotion.code } : null,
    promoError: priced.promoError,
    deliveryFee: priced.deliveryFee,
    total: priced.total,
    minOrderAmount: priced.minOrderAmount,
    minOrderShortfall: priced.minOrderShortfall,
    etaMinutes,
  };
}

export async function quote(slug: string, input: { items: CreateOrderInput['items']; promoCode?: string | null; deliveryPointId?: string | null }) {
  const d = db();
  const r = await getRestaurantBySlug(d, slug);
  if (!r) throw new AppError('NOT_FOUND', 'المحل غير موجود');
  if (!r.isActive) throw new AppError('STORE_CLOSED', closedMessage('CLOSED', 'INACTIVE'));
  const now = new Date();
  const [{ priced, point }, live] = await Promise.all([priceFor(d, r, input, now), getStoreLive(d, r, now)]);
  const eta = computeEta({ confirmedAt: now, activeLoad: live.load, orderLoad: priced.loadUnits, config: live.config, extraDeliveryMinutes: point.extraMinutes, fulfillmentType: point.fulfillmentType });
  return toQuote(priced, eta.prepMinutes + eta.deliveryMinutes, point.fulfillmentType);
}

export interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  trackingToken: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  total: number;
  replayed: boolean;
}

export interface CreateOrderOptions {
  /** Trusted server context: never taken from a public checkout body. */
  staff?: { userId: string; label: string; auth: AuthzSnapshot; ip?: string | null; userAgent?: string | null };
  cashReceived?: boolean;
}

function hashRequest(input: CreateOrderInput, options?: CreateOrderOptions): string {
  const canonical = JSON.stringify({
    items: input.items.map((i) => ({ p: i.productId, v: i.variantId ?? null, a: [...(i.addonIds ?? [])].sort(), q: i.quantity, n: i.note ?? null })),
    name: input.customerName,
    phone: input.customerPhone ?? null,
    note: input.note ?? null,
    pm: input.paymentMethod,
    promo: input.promoCode?.toUpperCase() ?? null,
    dp: input.deliveryPointId ?? null,
    ...(options?.staff ? { channel: 'COUNTER', actor: options.staff.userId, cashReceived: options.cashReceived === true } : {}),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

async function findByIdempotencyKey(d: Db, restaurantId: string, key: string) {
  const [o] = await d
    .select()
    .from(orders)
    .where(and(eq(orders.restaurantId, restaurantId), eq(orders.idempotencyKey, key)));
  return o ?? null;
}

function replay(o: typeof orders.$inferSelect, requestHash: string): CreatedOrder {
  if (o.requestHash !== requestHash) {
    throw new AppError('IDEMPOTENCY_MISMATCH', 'تم استخدام نفس مفتاح الطلب لبيانات مختلفة');
  }
  return {
    orderId: o.id,
    orderNumber: o.orderNumber,
    trackingToken: o.trackingToken,
    status: o.status,
    paymentMethod: o.paymentMethod,
    total: o.total,
    replayed: true,
  };
}

/**
 * Creates an order exactly once per Idempotency-Key. Everything (order number, items snapshot,
 * payment, promotion usage, first event) is written in one transaction.
 */
export async function createOrder(slug: string, input: CreateOrderInput, idempotencyKey: string, now = new Date(), admit?: (tx: Db) => Promise<void>, options?: CreateOrderOptions): Promise<CreatedOrder> {
  const d = db();
  const r = await getRestaurantBySlug(d, slug);
  if (!r) throw new AppError('NOT_FOUND', 'المحل غير موجود');
  const staff = options?.staff;
  if (staff && !hasPermission(staff.auth, 'orders.accept', r.id)) throw new AppError('FORBIDDEN', 'Not allowed to create counter orders');
  if (options?.cashReceived && (!staff || input.paymentMethod !== 'CASH' || !hasPermission(staff.auth, 'payments.verify', r.id))) {
    throw new AppError('FORBIDDEN', 'Not allowed to collect cash for this order');
  }
  const requestHash = hashRequest(input, options);

  const existing = await findByIdempotencyKey(d, r.id, idempotencyKey);
  if (existing) return replay(existing, requestHash);

  let phone: string | null = null;
  if (input.customerPhone) {
    phone = normalizeEgyptianPhone(input.customerPhone);
    if (!phone) throw new AppError('VALIDATION', 'رقم الموبايل غير صحيح', { field: 'customerPhone' });
  }
  const initial = initialStatusFor(input.paymentMethod);
  const staffCash = !!staff && input.paymentMethod === 'CASH';
  const status: OrderStatus = staffCash ? 'CONFIRMED' : initial.status;
  const paymentStatus = staffCash && options?.cashReceived ? 'PAYMENT_VERIFIED' as const : initial.paymentStatus;
  const trackingToken = randomBytes(18).toString('base64url');

  try {
    return await d.transaction(async (tx) => {
      // A concurrent retry waits here, then replays the committed order before checking
      // stock, payment methods or the last remaining promotion use.
      const [lockedCounter] = await tx.select().from(storeCounters).where(eq(storeCounters.restaurantId, r.id)).for('update');
      if (!lockedCounter) throw new AppError('INTERNAL', 'Restaurant counters missing');
      const concurrentOrder = await findByIdempotencyKey(tx, r.id, idempotencyKey);
      if (concurrentOrder) return replay(concurrentOrder, requestHash);

      // Recheck admission under the same per-store lock used by confirmations. A queue that
      // filled after the checkout screen opened must not silently accept another order.
      const currentRestaurant = await getRestaurant(tx, r.id);
      if (!currentRestaurant) throw new AppError('NOT_FOUND', 'المحل غير موجود');
      const currentLive = await getStoreLive(tx, currentRestaurant, now);
      if (!acceptsOrders(currentLive.status)) {
        throw new AppError(currentLive.status === 'PAUSED' ? 'STORE_PAUSED' : 'STORE_CLOSED', closedMessage(currentLive.status, currentLive.reason));
      }
      const [method] = await tx.select().from(restaurantPaymentMethods)
        .where(and(eq(restaurantPaymentMethods.restaurantId, r.id), eq(restaurantPaymentMethods.method, input.paymentMethod)));
      if (!method?.isEnabled) throw new AppError('PAYMENT_METHOD_DISABLED', 'طريقة الدفع دي مش متاحة حاليًا');
      const { priced, point } = await priceFor(tx, currentRestaurant, input, now);
      if (currentRestaurant.requirePhone && !phone && !(staff && point.fulfillmentType === 'PICKUP')) {
        throw new AppError('VALIDATION', 'رقم الموبايل مطلوب', { field: 'customerPhone' });
      }
      if (input.promoCode && priced.promoError) throw new AppError('PROMO_INVALID', priced.promoError.message);
      if (priced.minOrderShortfall > 0) throw new AppError('MIN_ORDER', `الحد الأدنى للطلب ${egp(priced.minOrderAmount)} ج.م`);
      // Admission is charged only for a new valid order, under the idempotency lock.
      // It commits with the order, so retries and rolled-back checkouts don't consume a phone allowance.
      if (admit) await admit(tx);
      const provisionalEta = computeEta({ confirmedAt: now, activeLoad: currentLive.load, orderLoad: priced.loadUnits, config: currentLive.config, extraDeliveryMinutes: point.extraMinutes, fulfillmentType: point.fulfillmentType });

      const [counter] = await tx.update(storeCounters)
        .set({ orderSeq: sql`${storeCounters.orderSeq} + 1`, eventSeq: sql`${storeCounters.eventSeq} + 1` })
        .where(eq(storeCounters.restaurantId, r.id)).returning();

      let customerId: string | null = null;
      if (phone) {
        const [c] = await tx
          .insert(customers)
          .values({ phone, name: input.customerName, ordersCount: 1, lastOrderAt: now })
          .onConflictDoUpdate({
            target: customers.phone,
            set: { name: input.customerName, ordersCount: sql`${customers.ordersCount} + 1`, lastOrderAt: now, updatedAt: now },
          })
          .returning({ id: customers.id });
        customerId = c.id;
      }

      if (priced.promotion) {
        const [used] = await tx
          .update(promotions)
          .set({ usedCount: sql`${promotions.usedCount} + 1` })
          .where(and(eq(promotions.id, priced.promotion.id), or(isNull(promotions.usageLimit), lt(promotions.usedCount, promotions.usageLimit))))
          .returning({ id: promotions.id });
        if (!used) throw new AppError('PROMO_INVALID', 'الكود استُخدم بالكامل');
      }

      const orderNumber = formatOrderNumber(counter.orderSeq);
      const [order] = await tx
        .insert(orders)
        .values({
          restaurantId: r.id,
          orderSeq: counter.orderSeq,
          orderNumber,
          trackingToken,
          idempotencyKey,
          requestHash,
          customerId,
          customerName: input.customerName,
          customerPhone: phone,
          customerNote: input.note || null,
          status,
          paymentMethod: input.paymentMethod,
          paymentStatus,
          cashReceivedAtCounter: staffCash && options?.cashReceived === true,
          deliveryPointId: point.id,
          deliveryPointName: point.nameAr,
          deliveryPointNameEn: point.nameEn,
          fulfillmentType: point.fulfillmentType,
          subtotal: priced.subtotal,
          discountTotal: priced.discount,
          deliveryFee: priced.deliveryFee,
          total: priced.total,
          currency: currentRestaurant.currency,
          commissionBps: priced.commissionBps,
          commissionAmount: priced.commissionAmount,
          merchantNet: priced.merchantNet,
          loadUnits: priced.loadUnits,
          promotionId: priced.promotion?.id ?? null,
          promoCode: priced.promotion?.code ?? null,
          source: staff ? 'COUNTER' : input.source || null,
          confirmedAt: staffCash ? now : null,
          estimatedPrepStartAt: staffCash ? provisionalEta.prepStartAt : null,
          estimatedReadyAt: provisionalEta.readyAt,
          estimatedArrivalAt: provisionalEta.arrivalAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      for (const [index, line] of priced.lines.entries()) {
        const [item] = await tx
          .insert(orderItems)
          .values({
            orderId: order.id,
            productId: line.productId,
            variantId: line.variantId,
            productNameAr: line.nameAr,
            productNameEn: line.nameEn,
            variantNameAr: line.variantNameAr,
            variantNameEn: line.variantNameEn,
            unitPrice: line.unitPrice,
            addonsPerUnit: line.addonsPerUnit,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
            loadUnitsPerUnit: line.loadUnitsPerUnit,
            note: line.note,
            sortOrder: index,
          })
          .returning({ id: orderItems.id });
        if (line.addons.length) {
          await tx.insert(orderItemAddons).values(
            line.addons.map((a) => ({ orderItemId: item.id, addonId: a.id, groupNameAr: a.groupNameAr, nameAr: a.nameAr, nameEn: a.nameEn, price: a.price })),
          );
        }
      }

      await tx.insert(payments).values({ orderId: order.id, restaurantId: r.id, method: input.paymentMethod, status: paymentStatus, amount: priced.total,
        verifiedAt: staffCash && options?.cashReceived ? now : null, verifiedByUserId: staffCash && options?.cashReceived ? staff!.userId : null });
      if (priced.promotion) {
        await tx.insert(promotionUsages).values({ promotionId: priced.promotion.id, orderId: order.id, discount: priced.discount });
      }
      await tx.insert(orderEvents).values({
        restaurantId: r.id,
        orderId: order.id,
        seq: counter.eventSeq,
        type: 'ORDER_CREATED',
        action: null,
        fromStatus: null,
        toStatus: status,
        actorType: staff ? 'USER' : 'CUSTOMER',
        actorUserId: staff?.userId ?? null,
        data: { total: priced.total, items: priced.lines.length, source: staff ? 'COUNTER' : input.source ?? null, fulfillmentType: point.fulfillmentType, ...(staff ? { actorLabel: staff.label, cashReceived: options?.cashReceived === true } : {}) },
        occurredAt: now,
      });

      if (staff) {
        await audit({ actor: { type: 'USER', userId: staff.userId, label: staff.label }, action: 'order.counter_created',
          entity: 'order', entityId: order.id, restaurantId: r.id,
          after: { orderNumber, total: priced.total, status, paymentMethod: input.paymentMethod, paymentStatus, fulfillmentType: point.fulfillmentType, cashReceived: options?.cashReceived === true },
          ip: staff.ip, userAgent: staff.userAgent }, tx);
      }

      return {
        orderId: order.id,
        orderNumber,
        trackingToken,
        status,
        paymentMethod: input.paymentMethod,
        total: priced.total,
        replayed: false,
      } satisfies CreatedOrder;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'orders_idempotency_uq')) {
      const winner = await findByIdempotencyKey(d, r.id, idempotencyKey);
      if (winner) return replay(winner, requestHash);
    }
    throw err;
  }
}
