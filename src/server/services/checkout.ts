import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db, isUniqueViolation, type Db } from '../db';
import {
  customers,
  deliveryPoints,
  orderEvents,
  orderItemAddons,
  orderItems,
  orders,
  payments,
  products,
  promotions,
  promotionUsages,
  restaurantPaymentMethods,
  storeCounters,
} from '../db/schema';
import { AppError } from '../errors';
import { ACTIVE_STATUSES, initialStatusFor, type OrderChannel, type OrderStatus, type PaymentMethod } from '../../lib/domain/order-machine';
import { getRiskPolicy } from './risk';
import { egp, priceCart, type PricedCart, type PricingMode } from '../../lib/domain/pricing';
import { formatOrderNumber, normalizeEgyptianPhone } from '../../lib/domain/misc';
import { acceptsOrders } from '../../lib/domain/store-status';
import { computeEta } from '../../lib/domain/queue';
import type { CreateOrderInput } from '../../lib/validation';
import type { CustomerQuoteResponse, QuoteResponse } from '../../lib/types';
import { customerPriceTotals, publishLinePrices, publishedFoodPrice } from '../../lib/domain/customer-pricing';
import { loadMenuCatalog, loadPromotionRules } from './menu';
import { audit } from './audit';
import { hasPermission, type AuthzSnapshot } from '../../lib/domain/permissions';
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

async function priceFor(d: Db, r: RestaurantRow, input: { items: CreateOrderInput['items']; promoCode?: string | null; deliveryPointId?: string | null }, now: Date, pricingMode: PricingMode = 'ONLINE_PLATFORM_FEE') {
  const point = await resolveDeliveryPoint(d, r.id, input.deliveryPointId);
  const [catalog, promos] = await Promise.all([loadMenuCatalog(d, r.id), loadPromotionRules(d, r.id, input.promoCode)]);
  const priced = priceCart(input.items, {
    products: catalog.products,
    addonGroups: catalog.addonGroups,
    promotions: promos,
    promoCode: input.promoCode,
    now,
    // Collecting at the restaurant never carries a delivery fee.
    deliveryFee: point.kind === 'PICKUP' ? 0 : point.deliveryFee,
    minOrderAmount: r.minOrderAmount,
    commissionBps: pricingMode === 'COUNTER_NO_FEE' ? 0 : r.commissionBps,
    serviceFee: r.serviceFee,
    platformDeliveryFee: point.kind === 'PICKUP' ? 0 : r.platformDeliveryFee,
    platformDeliveryPayer: r.platformDeliveryPayer,
    pricingMode,
  });
  return { priced, point };
}

function toQuote(priced: PricedCart, etaMinutes: number): QuoteResponse {
  return {
    pricingMode: priced.pricingMode,
    platformFeeAmount: priced.platformFeeAmount,
    platformFeeBps: priced.platformFeeBps,
    serviceFee: priced.serviceFee,
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

/**
 * Customer receipts use the published all-in food price. The accounting split
 * is deliberately absent from the public API and the displayed math remains
 * subtotal − discount + delivery + service fee = total.
 */
export function toCustomerQuote(quote: QuoteResponse): CustomerQuoteResponse {
  const totals = customerPriceTotals({
    pricingMode: quote.pricingMode,
    subtotal: quote.subtotal,
    discount: quote.discount,
    deliveryFee: quote.deliveryFee,
    total: quote.total,
    platformFeeAmount: quote.platformFeeAmount,
    platformFeeBps: quote.platformFeeBps,
    serviceFee: quote.serviceFee,
  });
  const { pricingMode: _pricingMode, platformFeeAmount: _platformFeeAmount, platformFeeBps: _platformFeeBps, ...publicQuote } = quote;
  const rate = quote.pricingMode === 'ONLINE_PLATFORM_FEE' ? quote.platformFeeBps ?? 0 : 0;
  const minOrderAmount = rate ? publishedFoodPrice(quote.minOrderAmount, rate) : quote.minOrderAmount;
  return {
    ...publicQuote,
    lines: publishLinePrices(quote.lines, totals.addedToFood, rate),
    subtotal: totals.subtotal,
    discount: totals.discount,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    minOrderAmount,
    minOrderShortfall: Math.max(0, minOrderAmount - totals.subtotal),
  };
}

export type QuoteInput = { items: CreateOrderInput['items']; promoCode?: string | null; deliveryPointId?: string | null };

async function quoteFor(d: Db, r: RestaurantRow, input: QuoteInput, pricingMode: PricingMode): Promise<QuoteResponse> {
  if (!r.isActive) throw new AppError('STORE_CLOSED', closedMessage('CLOSED', 'INACTIVE'));
  const now = new Date();
  const [{ priced, point }, live] = await Promise.all([priceFor(d, r, input, now, pricingMode), getStoreLive(d, r, now)]);
  const eta = computeEta({ confirmedAt: now, activeLoad: live.load, orderLoad: priced.loadUnits, config: live.config, extraDeliveryMinutes: point.extraMinutes, pickup: point.kind === 'PICKUP' });
  return toQuote(priced, eta.prepMinutes + eta.deliveryMinutes);
}

export async function quote(slug: string, input: QuoteInput) {
  const d = db();
  const r = await getRestaurantBySlug(d, slug);
  if (!r) throw new AppError('NOT_FOUND', 'المحل غير موجود');
  return quoteFor(d, r, input, 'ONLINE_PLATFORM_FEE');
}

/** Counter pricing is available only through trusted staff authentication, never a public channel flag. */
export async function quoteCounterOrder(restaurantId: string, input: QuoteInput, auth: AuthzSnapshot) {
  if (!hasPermission(auth, 'orders.create', restaurantId)) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
  const d = db();
  const r = await getRestaurant(d, restaurantId);
  if (!r) throw new AppError('NOT_FOUND', 'المحل غير موجود');
  // Counter creation has no manual promo-code field; quotes must follow that same contract.
  // Automatic promotions still apply through the shared pricing engine.
  return quoteFor(d, r, { ...input, promoCode: null }, 'COUNTER_NO_FEE');
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

function hashRequest(input: CreateOrderInput): string {
  const canonical = JSON.stringify({
    items: input.items.map((i) => ({ p: i.productId, v: i.variantId ?? null, a: [...(i.addonIds ?? [])].sort(), q: i.quantity, n: i.note ?? null })),
    name: input.customerName,
    phone: input.customerPhone ?? null,
    note: input.note ?? null,
    pm: input.paymentMethod,
    promo: input.promoCode?.toUpperCase() ?? null,
    dp: input.deliveryPointId ?? null,
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

function replay(o: typeof orders.$inferSelect, requestHash: string, opts: CreateOptions): CreatedOrder {
  // A public key must never reveal a staff order's tracking token or bypass online pricing.
  if (o.channel !== opts.channel || (opts.channel === 'COUNTER' && o.createdByUserId !== opts.createdByUserId)) {
    throw new AppError('FORBIDDEN', 'Not allowed to replay this order');
  }
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
export async function createOrder(slug: string, input: CreateOrderInput, idempotencyKey: string, now = new Date(), admit?: (tx: Db) => Promise<void>): Promise<CreatedOrder> {
  const r = await getRestaurantBySlug(db(), slug);
  if (!r) throw new AppError('NOT_FOUND', 'المحل غير موجود');
  return createOrderFor(r, input, idempotencyKey, now, { channel: 'ONLINE', admit });
}

interface CreateOptions {
  channel: OrderChannel;
  /** Staff member entering a counter order. */
  createdByUserId?: string | null;
  actorMeta?: { label: string; deviceId?: string | null; ip?: string | null; userAgent?: string | null };
  admit?: (tx: Db) => Promise<void>;
}

/**
 * Online orders follow every customer-facing rule (opening hours, pause, enabled payment methods,
 * minimum order, required phone). Counter orders are entered by staff for someone standing at the
 * register, so those online-only rules don't apply. Platform suspension and cash kitchen capacity
 * still apply to both channels.
 */
async function createOrderFor(r: RestaurantRow, input: CreateOrderInput, idempotencyKey: string, now: Date, opts: CreateOptions): Promise<CreatedOrder> {
  const d = db();
  const isCounter = opts.channel === 'COUNTER';
  const requestHash = hashRequest(input);

  const existing = await findByIdempotencyKey(d, r.id, idempotencyKey);
  if (existing) return replay(existing, requestHash, opts);

  let phone: string | null = null;
  if (input.customerPhone) {
    phone = normalizeEgyptianPhone(input.customerPhone);
    if (!phone) throw new AppError('VALIDATION', 'رقم الموبايل غير صحيح', { field: 'customerPhone' });
  }
  const initial = initialStatusFor(input.paymentMethod);
  const autoAcceptCash = input.paymentMethod === 'CASH';
  const status: OrderStatus = autoAcceptCash ? 'CONFIRMED' : initial.status;
  const paymentStatus = initial.paymentStatus;
  const trackingToken = randomBytes(18).toString('base64url');

  try {
    return await d.transaction(async (tx) => {
      // A concurrent retry waits here, then replays the committed order before checking
      // stock, payment methods or the last remaining promotion use.
      const [lockedCounter] = await tx.select().from(storeCounters).where(eq(storeCounters.restaurantId, r.id)).for('update');
      if (!lockedCounter) throw new AppError('INTERNAL', 'Restaurant counters missing');
      const concurrentOrder = await findByIdempotencyKey(tx, r.id, idempotencyKey);
      if (concurrentOrder) return replay(concurrentOrder, requestHash, opts);

      // Recheck admission under the same per-store lock used by confirmations. A queue that
      // filled after the checkout screen opened must not silently accept another order.
      const currentRestaurant = await getRestaurant(tx, r.id);
      if (!currentRestaurant) throw new AppError('NOT_FOUND', 'المحل غير موجود');
      if (!isCounter && currentRestaurant.requirePhone && !phone) throw new AppError('VALIDATION', 'رقم الموبايل مطلوب', { field: 'customerPhone' });
      const currentLive = await getStoreLive(tx, currentRestaurant, now);
      if (!currentRestaurant.isActive) throw new AppError('STORE_CLOSED', closedMessage('CLOSED', 'INACTIVE'));
      if (!isCounter && !acceptsOrders(currentLive.status)) {
        throw new AppError(currentLive.status === 'PAUSED' ? 'STORE_PAUSED' : 'STORE_CLOSED', closedMessage(currentLive.status, currentLive.reason));
      }
      if (!isCounter) {
        const [method] = await tx.select().from(restaurantPaymentMethods)
          .where(and(eq(restaurantPaymentMethods.restaurantId, r.id), eq(restaurantPaymentMethods.method, input.paymentMethod)));
        if (!method?.isEnabled) throw new AppError('PAYMENT_METHOD_DISABLED', 'طريقة الدفع دي مش متاحة حاليًا');
      }
      const pricingMode: PricingMode = isCounter ? 'COUNTER_NO_FEE' : 'ONLINE_PLATFORM_FEE';
      const { priced, point } = await priceFor(tx, currentRestaurant, input, now, pricingMode);
      // Every order claims its load under the same store lock: cash enters the kitchen now, InstaPay
      // holds its place until paid (or the unpaid timeout releases it). A 5-unit kitchen accepts a
      // fifth unit but never a simultaneous sixth one, whatever the payment method.
      const cfg = currentLive.config;
      const claimedLoad = currentLive.load + currentLive.reservedLoad;
      const claimedOrders = currentLive.activeOrders + currentLive.reservedOrders;
      if (cfg.autoPause && (
        (cfg.maxAcceptedLoad > 0 && claimedLoad + priced.loadUnits > cfg.maxAcceptedLoad) ||
        (cfg.maxActiveOrders > 0 && claimedOrders + 1 > cfg.maxActiveOrders)
      )) throw new AppError('STORE_PAUSED', closedMessage('PAUSED', 'CAPACITY'));
      if (!isCounter && phone) await enforcePhonePolicy(tx, phone, input.paymentMethod);
      if (input.promoCode && priced.promoError) throw new AppError('PROMO_INVALID', priced.promoError.message);
      if (priced.promotion) {
        // A personal voucher (ELSANE prize) works only for the phone that won it.
        const [promo] = await tx.select({ customerPhone: promotions.customerPhone }).from(promotions).where(eq(promotions.id, priced.promotion.id));
        if (promo?.customerPhone && promo.customerPhone !== phone) throw new AppError('PROMO_INVALID', 'الكود ده خاص برقم الموبايل اللي كسبه');
      }
      if (!isCounter && priced.minOrderShortfall > 0) throw new AppError('MIN_ORDER', `الحد الأدنى للطلب ${egp(publishedFoodPrice(priced.minOrderAmount, priced.platformFeeBps))} ج.م`);
      // Admission is charged only for a new valid order, under the idempotency lock.
      // It commits with the order, so retries and rolled-back checkouts don't consume a phone allowance.
      if (opts.admit) await opts.admit(tx);
      await takeStock(tx, priced, now);
      const provisionalEta = computeEta({ confirmedAt: now, activeLoad: currentLive.load, orderLoad: priced.loadUnits, config: currentLive.config, extraDeliveryMinutes: point.extraMinutes, pickup: point.kind === 'PICKUP' });

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
          deliveryPointId: point.id,
          deliveryPointName: point.nameAr,
          deliveryPointNameEn: point.nameEn,
          fulfillment: point.kind,
          channel: opts.channel,
          createdByUserId: opts.createdByUserId ?? null,
          subtotal: priced.subtotal,
          discountTotal: priced.discount,
          deliveryFee: priced.deliveryFee,
          total: priced.total,
          currency: currentRestaurant.currency,
          pricingMode: priced.pricingMode,
          platformFeeAmount: priced.platformFeeAmount,
          serviceFee: priced.serviceFee,
          platformDeliveryFee: priced.platformDeliveryFee,
          platformDeliveryPayer: priced.platformDeliveryPayer,
          commissionBps: priced.commissionBps,
          commissionAmount: priced.commissionAmount,
          merchantNet: priced.merchantNet,
          loadUnits: priced.loadUnits,
          promotionId: priced.promotion?.id ?? null,
          promoCode: priced.promotion?.code ?? null,
          source: input.source || null,
          confirmedAt: autoAcceptCash ? now : null,
          estimatedPrepStartAt: autoAcceptCash ? provisionalEta.prepStartAt : null,
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

      await tx.insert(payments).values({ orderId: order.id, restaurantId: r.id, method: input.paymentMethod, status: paymentStatus, amount: priced.total });
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
        actorType: isCounter ? 'USER' : 'CUSTOMER',
        actorUserId: opts.createdByUserId ?? null,
        data: { total: priced.total, items: priced.lines.length, source: input.source ?? null, channel: opts.channel, fulfillment: point.kind, pricingMode: priced.pricingMode, platformFeeAmount: priced.platformFeeAmount, autoAccepted: autoAcceptCash },
        occurredAt: now,
      });

      if (isCounter) {
        await audit({
          actor: { type: 'USER', userId: opts.createdByUserId, label: opts.actorMeta?.label },
          action: 'order.counter_created', entity: 'order', entityId: order.id, restaurantId: r.id,
          after: { orderNumber, total: priced.total, status, paymentMethod: input.paymentMethod, pricingMode, platformFeeAmount: priced.platformFeeAmount, fulfillment: point.kind },
          deviceId: opts.actorMeta?.deviceId, ip: opts.actorMeta?.ip, userAgent: opts.actorMeta?.userAgent,
        }, tx);
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
      if (winner) return replay(winner, requestHash, opts);
    }
    throw err;
  }
}

/**
 * Guest checkout has no account, so the phone number carries the risk rules for online orders:
 * blocked numbers can't order, numbers with repeated no-shows can't choose cash, and one number
 * can't hold too many open orders at once across the platform.
 */
async function enforcePhonePolicy(tx: Db, phone: string, method: PaymentMethod) {
  const [customer] = await tx.select().from(customers).where(eq(customers.phone, phone));
  if (!customer) return;
  if (customer.isBlocked) throw new AppError('FORBIDDEN', 'الرقم ده موقوف من الطلب أونلاين. تواصل مع الدعم.');
  const policy = await getRiskPolicy(tx);
  if (method === 'CASH' && policy.noShowCashLimit > 0 && customer.noShowCount >= policy.noShowCashLimit) {
    throw new AppError('PAYMENT_METHOD_DISABLED', 'الدفع كاش مش متاح للرقم ده بسبب طلبات قبل كده ما اتستلمتش. ادفع بإنستاباي.');
  }
  if (policy.maxOpenOrdersPerPhone > 0) {
    const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.customerId, customer.id), eq(orders.channel, 'ONLINE'), inArray(orders.status, [...ACTIVE_STATUSES])));
    if (Number(open?.n ?? 0) >= policy.maxOpenOrdersPerPhone) {
      throw new AppError('RATE_LIMITED', 'عندك طلبات لسه مفتوحة على الرقم ده. استنى لما تستلمها وبعدين اطلب تاني.');
    }
  }
}

/**
 * Tracked products give up what this order takes, under the store lock that serialises orders.
 * Pricing already refused quantities above what is left; the guarded update is a last line of
 * defence against a concurrent manual stock edit.
 */
async function takeStock(tx: Db, priced: PricedCart, now: Date) {
  const wanted = new Map<string, number>();
  for (const l of priced.lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
  const tracked = await tx.select({ id: products.id, nameAr: products.nameAr }).from(products)
    .where(and(inArray(products.id, [...wanted.keys()]), eq(products.trackStock, true)));
  for (const p of tracked) {
    const qty = wanted.get(p.id)!;
    const [left] = await tx.update(products)
      .set({ stockQty: sql`${products.stockQty} - ${qty}`, updatedAt: now })
      .where(and(eq(products.id, p.id), gte(products.stockQty, qty)))
      .returning({ id: products.id });
    if (!left) throw new AppError('CONFLICT', `${p.nameAr} خلص حالًا. حدّث السلة وجرّب تاني.`);
  }
}

export interface CounterOrderInput {
  items: CreateOrderInput['items'];
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  paymentMethod: PaymentMethod;
  deliveryPointId?: string | null;
}

/**
 * Walk-in order entered at the register. It is created like any order (same pricing, snapshots,
 * order number and event log). Cash enters the kitchen atomically; InstaPay still waits for
 * an explicit payment verification with the appropriate permission.
 */
export async function createCounterOrder(
  restaurantId: string,
  input: CounterOrderInput,
  idempotencyKey: string,
  staff: { userId: string; name: string; auth: AuthzSnapshot; deviceId?: string | null; ip?: string | null; userAgent?: string | null },
  now = new Date(),
): Promise<CreatedOrder> {
  const r = await getRestaurant(db(), restaurantId);
  if (!r) throw new AppError('NOT_FOUND', 'المحل غير موجود');
  if (!hasPermission(staff.auth, 'orders.create', r.id)) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
  return createOrderFor(
    r,
    {
      items: input.items,
      customerName: input.customerName?.trim() || 'عميل المحل',
      customerPhone: input.customerPhone?.trim() || null,
      note: input.note?.trim() || null,
      paymentMethod: input.paymentMethod,
      promoCode: null,
      deliveryPointId: input.deliveryPointId ?? null,
      source: 'counter',
    },
    idempotencyKey,
    now,
    { channel: 'COUNTER', createdByUserId: staff.userId, actorMeta: { label: staff.name, deviceId: staff.deviceId, ip: staff.ip, userAgent: staff.userAgent } },
  );
}
