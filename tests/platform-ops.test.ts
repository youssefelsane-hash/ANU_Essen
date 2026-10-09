/**
 * Platform fees (percentage + fixed), platform delivery, optional stock, phone risk rules,
 * InstaPay capacity holds, the customer's cancel window, search, reviews, support tickets,
 * delegation guards and the close-of-day report.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as s from '@/server/db/schema';
import type { Db } from '@/server/db';
import type { AuthContext } from '@/server/auth/authz';
import { AppError } from '@/server/errors';
import { createCounterOrder, createOrder } from '@/server/services/checkout';
import { applyOrderAction, type ActionActor } from '@/server/services/order-actions';
import { loadTrackingView } from '@/server/services/order-views';
import { loadPublicMenu } from '@/server/services/menu';
import { recordNoShow } from '@/server/services/risk';
import { foldArabic, searchFood } from '@/server/services/search';
import { listReviews, restaurantRatings, submitReview } from '@/server/services/reviews';
import { createTicket, customerReply, listTickets, staffReply, ticketForStaff } from '@/server/services/support';
import { dailyClose } from '@/server/services/stats';
import { assertCanGrant, assertOutranks } from '@/server/auth/delegation';
import { priceCart } from '@/lib/domain/pricing';
import { customerPriceTotals } from '@/lib/domain/customer-pricing';
import { CUSTOMER_CANCEL_GRACE_MINUTES } from '@/lib/domain/risk';
import { authFor, setupTestDb } from './helpers/db';

let d: Db;
let restaurantId: string;
let productId: string, variantId: string;
let owner: AuthContext, kitchen: AuthContext, admin: AuthContext;
let n = 0;
const key = () => `ops-${++n}-${Math.random().toString(36).slice(2)}`;
const staff = (a: AuthContext): ActionActor => ({ type: 'USER', userId: a.user.id, label: a.user.name, auth: a });
const customer: ActionActor = { type: 'CUSTOMER', label: 'customer' };
const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
const items = (quantity = 1) => [{ productId, variantId, addonIds: [], quantity }];
const phone = () => `010${String(10_000_000 + n * 7919).slice(-8)}`;
const setRestaurant = (patch: Partial<typeof s.restaurants.$inferInsert>) => d.update(s.restaurants).set(patch).where(eq(s.restaurants.id, restaurantId));
const setRisk = (value: { maxOpenOrdersPerPhone: number; noShowCashLimit: number }) =>
  d.insert(s.systemSettings).values({ key: 'risk.policy', value }).onConflictDoUpdate({ target: s.systemSettings.key, set: { value } });
const orderRow = async (id: string) => (await d.select().from(s.orders).where(eq(s.orders.id, id)))[0];
const deliveryPoint = async () => (await d.select().from(s.deliveryPoints).where(eq(s.deliveryPoints.restaurantId, restaurantId))).find((p) => p.kind === 'DELIVERY')!;

async function deliverCash(orderId: string) {
  for (const action of ['MARK_READY', 'OUT_FOR_DELIVERY', 'MARK_ARRIVED', 'COMPLETE'] as const) await applyOrderAction({ orderId, action, actor: staff(owner) });
}

beforeAll(async () => {
  let demo;
  ({ d, demo } = await setupTestDb());
  restaurantId = demo.restaurantId;
  productId = demo.productIds['Chicken Shawarma Sandwich'];
  variantId = demo.variantIds['Chicken Shawarma Sandwich:Regular'];
  owner = await authFor(d, 'owner@alrayez.test');
  kitchen = await authFor(d, 'kitchen@alrayez.test');
  admin = await authFor(d, 'admin@test.local');
});

beforeEach(async () => {
  await setRestaurant({ serviceFee: 0, platformDeliveryFee: 0, platformDeliveryPayer: 'CUSTOMER', commissionBps: 500 });
  await setRisk({ maxOpenOrdersPerPhone: 0, noShowCashLimit: 0 });
  await d.update(s.products).set({ trackStock: false, stockQty: 0, showStock: false }).where(eq(s.products.id, productId));
});

describe('platform money', () => {
  const product = { id: 'p', nameAr: 'ساندوتش', nameEn: 'Sandwich', basePrice: 10_000, isAvailable: true, isActive: true, prepLoadUnits: 1, variants: [], addonGroupIds: [] };
  const ctx = { products: new Map([['p', product]]), addonGroups: new Map(), promotions: [], now: new Date(), deliveryFee: 1_000, minOrderAmount: 0, commissionBps: 500, pricingMode: 'ONLINE_PLATFORM_FEE' as const };

  it('adds a percentage and/or a fixed fee on top for the customer; the restaurant keeps its price', () => {
    const both = priceCart([{ productId: 'p', variantId: null, addonIds: [], quantity: 1 }], { ...ctx, serviceFee: 500 });
    expect(both.platformFeeAmount).toBe(500);
    expect(both.serviceFee).toBe(500);
    expect(both.total).toBe(10_000 + 1_000 + 500 + 500);
    expect(both.commissionAmount).toBe(1_000);
    expect(both.merchantNet).toBe(11_000);
    const fixedOnly = priceCart([{ productId: 'p', variantId: null, addonIds: [], quantity: 1 }], { ...ctx, commissionBps: 0, serviceFee: 500 });
    expect(fixedOnly.commissionAmount).toBe(500);
    expect(fixedOnly.total).toBe(11_500);
    // Counter orders never carry a platform fee.
    const counter = priceCart([{ productId: 'p', variantId: null, addonIds: [], quantity: 1 }], { ...ctx, serviceFee: 500, pricingMode: 'COUNTER_NO_FEE' });
    expect(counter.serviceFee + counter.platformFeeAmount).toBe(0);
  });

  it('charges platform delivery to the customer or deducts it from the restaurant', () => {
    const line = [{ productId: 'p', variantId: null, addonIds: [], quantity: 1 }];
    const onCustomer = priceCart(line, { ...ctx, commissionBps: 0, platformDeliveryFee: 1_500, platformDeliveryPayer: 'CUSTOMER' });
    expect(onCustomer.deliveryFee).toBe(2_500);
    expect(onCustomer.total).toBe(12_500);
    expect(onCustomer.merchantNet).toBe(11_000);
    const onRestaurant = priceCart(line, { ...ctx, commissionBps: 0, platformDeliveryFee: 1_500, platformDeliveryPayer: 'RESTAURANT' });
    expect(onRestaurant.total).toBe(11_000);
    expect(onRestaurant.commissionAmount).toBe(1_500);
    expect(onRestaurant.merchantNet).toBe(9_500);
  });

  it('keeps the customer bill arithmetic complete with a service-fee row', () => {
    const priced = priceCart([{ productId: 'p', variantId: null, addonIds: [], quantity: 1 }], { ...ctx, serviceFee: 300 });
    const shown = customerPriceTotals({ pricingMode: priced.pricingMode, subtotal: priced.subtotal, discount: priced.discount, deliveryFee: priced.deliveryFee, total: priced.total, platformFeeAmount: priced.platformFeeAmount, platformFeeBps: priced.platformFeeBps, serviceFee: priced.serviceFee });
    expect(shown.subtotal - shown.discount + shown.deliveryFee + shown.serviceFee).toBe(shown.total);
  });

  it('snapshots fees on real orders; tracking shows the service fee', async () => {
    await setRestaurant({ serviceFee: 300, platformDeliveryFee: 1_000, platformDeliveryPayer: 'RESTAURANT' });
    const point = await deliveryPoint();
    const o = await createOrder('alrayez', { items: items(), customerName: 'Mai', customerPhone: phone(), paymentMethod: 'CASH', deliveryPointId: point.id }, key());
    const row = await orderRow(o.orderId);
    expect(row.serviceFee).toBe(300);
    expect(row.platformDeliveryFee).toBe(1_000);
    expect(row.platformDeliveryPayer).toBe('RESTAURANT');
    expect(row.commissionAmount).toBe(row.platformFeeAmount + 300 + 1_000);
    expect(row.merchantNet).toBe(row.total - row.commissionAmount);
    expect((await loadTrackingView(d, o.trackingToken))!.order.serviceFee).toBe(300);
  });
});

describe('optional stock', () => {
  it('takes from stock, refuses more than what is left, gives it back on cancel', async () => {
    await d.update(s.products).set({ trackStock: true, stockQty: 3, showStock: true }).where(eq(s.products.id, productId));
    const menu = await loadPublicMenu(d, 'alrayez');
    expect(menu!.products.find((p) => p.id === productId)!.stockLeft).toBe(3);

    const a = await createOrder('alrayez', { items: items(2), customerName: 'A', customerPhone: phone(), paymentMethod: 'CASH' }, key());
    await expect(createOrder('alrayez', { items: items(2), customerName: 'B', customerPhone: phone(), paymentMethod: 'CASH' }, key())).rejects.toThrow(/متبقي 1/);
    const [p] = await d.select().from(s.products).where(eq(s.products.id, productId));
    expect(p.stockQty).toBe(1);
    await applyOrderAction({ orderId: a.orderId, action: 'CANCEL', actor: staff(owner), payload: { reason: 'test' } });
    expect((await d.select().from(s.products).where(eq(s.products.id, productId)))[0].stockQty).toBe(3);
  });

  it('hides the count from customers unless the restaurant shows it, and sells out at zero', async () => {
    await d.update(s.products).set({ trackStock: true, stockQty: 0, showStock: false }).where(eq(s.products.id, productId));
    const p = (await loadPublicMenu(d, 'alrayez'))!.products.find((x) => x.id === productId)!;
    expect(p.stockLeft).toBeNull();
    expect(p.isAvailable).toBe(false);
  });
});

describe('fake-order protection', () => {
  it('limits open orders per phone, blocks numbers, and turns cash off after no-shows', async () => {
    const tel = phone();
    await setRisk({ maxOpenOrdersPerPhone: 1, noShowCashLimit: 1 });
    const first = await createOrder('alrayez', { items: items(), customerName: 'Z', customerPhone: tel, paymentMethod: 'CASH' }, key());
    await expectCode(createOrder('alrayez', { items: items(), customerName: 'Z', customerPhone: tel, paymentMethod: 'CASH' }, key()), 'RATE_LIMITED');
    // Counter orders are entered by staff and never limited.
    await createCounterOrder(restaurantId, { items: items(), customerPhone: tel, paymentMethod: 'CASH' }, key(), { userId: owner.user.id, name: owner.user.name, auth: owner });

    await applyOrderAction({ orderId: first.orderId, action: 'CANCEL', actor: staff(owner), payload: { reason: 'العميل ما استلمش الطلب' } });
    const stored = (await orderRow(first.orderId)).customerPhone!;
    await recordNoShow(d, stored);
    const [c] = await d.select().from(s.customers).where(eq(s.customers.phone, stored));
    expect(c.noShowCount).toBe(1);
    await expectCode(createOrder('alrayez', { items: items(), customerName: 'Z', customerPhone: tel, paymentMethod: 'CASH' }, key()), 'PAYMENT_METHOD_DISABLED');
    const paid = await createOrder('alrayez', { items: items(), customerName: 'Z', customerPhone: tel, paymentMethod: 'INSTAPAY' }, key());
    expect(paid.status).toBe('AWAITING_PAYMENT');

    await d.update(s.customers).set({ isBlocked: true }).where(eq(s.customers.id, c.id));
    await expectCode(createOrder('alrayez', { items: items(), customerName: 'Z', customerPhone: tel, paymentMethod: 'INSTAPAY' }, key()), 'FORBIDDEN');
  });
});

describe('customer cancel window', () => {
  it('lets a customer take back a fresh cash order, but not after the window or once paid online', async () => {
    const now = new Date();
    const fresh = await createOrder('alrayez', { items: items(), customerName: 'Q', customerPhone: phone(), paymentMethod: 'CASH' }, key(), now);
    expect((await loadTrackingView(d, fresh.trackingToken))!.order.cancelGraceUntil).toBeGreaterThan(Date.now());
    await applyOrderAction({ orderId: fresh.orderId, action: 'CANCEL', actor: customer });
    expect((await orderRow(fresh.orderId)).status).toBe('CANCELLED');

    const old = new Date(Date.now() - (CUSTOMER_CANCEL_GRACE_MINUTES + 1) * 60_000);
    const late = await createOrder('alrayez', { items: items(), customerName: 'Q', customerPhone: phone(), paymentMethod: 'CASH' }, key(), old);
    await expectCode(applyOrderAction({ orderId: late.orderId, action: 'CANCEL', actor: customer }), 'FORBIDDEN');

    const cooking = await createOrder('alrayez', { items: items(), customerName: 'Q', customerPhone: phone(), paymentMethod: 'CASH' }, key());
    await applyOrderAction({ orderId: cooking.orderId, action: 'START_PREPARING', actor: staff(kitchen) });
    await expectCode(applyOrderAction({ orderId: cooking.orderId, action: 'CANCEL', actor: customer }), 'FORBIDDEN');
  });
});

describe('InstaPay capacity holds', () => {
  it('reserves kitchen room for unpaid transfers so verifying them never overflows the kitchen', async () => {
    const [cfgRow] = await d.select().from(s.queueConfigs).where(eq(s.queueConfigs.restaurantId, restaurantId));
    const original = cfgRow.config;
    // Drain earlier suites' kitchen load first.
    const active = await d.select({ id: s.orders.id, status: s.orders.status }).from(s.orders).where(eq(s.orders.restaurantId, restaurantId));
    for (const o of active.filter((x) => !['COMPLETED', 'CANCELLED'].includes(x.status))) await applyOrderAction({ orderId: o.id, action: 'CANCEL', actor: staff(owner), payload: { reason: 'reset' } });
    await d.update(s.queueConfigs).set({ config: { ...original, maxAcceptedLoad: 2, maxActiveOrders: 0, autoPause: true } }).where(eq(s.queueConfigs.restaurantId, restaurantId));
    try {
      const held = await createOrder('alrayez', { items: items(2), customerName: 'H', customerPhone: phone(), paymentMethod: 'INSTAPAY' }, key());
      await expectCode(createOrder('alrayez', { items: items(), customerName: 'C', customerPhone: phone(), paymentMethod: 'CASH' }, key()), 'STORE_PAUSED');
      await applyOrderAction({ orderId: held.orderId, action: 'VERIFY_PAYMENT', actor: staff(owner) });
      expect((await orderRow(held.orderId)).status).toBe('CONFIRMED');
    } finally {
      await d.update(s.queueConfigs).set({ config: original }).where(eq(s.queueConfigs.restaurantId, restaurantId));
      const left = await d.select({ id: s.orders.id, status: s.orders.status }).from(s.orders).where(eq(s.orders.restaurantId, restaurantId));
      for (const o of left.filter((x) => !['COMPLETED', 'CANCELLED'].includes(x.status))) await applyOrderAction({ orderId: o.id, action: 'CANCEL', actor: staff(owner), payload: { reason: 'reset' } });
    }
  });
});

describe('search across restaurants', () => {
  it('folds Arabic spelling variants', async () => {
    expect(foldArabic('شاورمَا فراخ')).toBe('شاورما فراخ');
    expect(foldArabic('إسكندرية')).toBe('اسكندريه');
    const [p] = await d.select().from(s.products).where(eq(s.products.id, productId));
    const results = await searchFood(d, p.nameAr.slice(0, 6));
    expect(results.some((r) => r.productId === productId && r.restaurant.slug === 'alrayez')).toBe(true);
    expect(await searchFood(d, 'x')).toEqual([]);
  });
});

describe('reviews', () => {
  it('rates a delivered order once; hidden reviews leave the average', async () => {
    const o = await createOrder('alrayez', { items: items(), customerName: 'Rana Ali', customerPhone: phone(), paymentMethod: 'CASH' }, key());
    await expectCode(submitReview({ token: o.trackingToken, rating: 5 }), 'CONFLICT');
    await deliverCash(o.orderId);
    expect((await loadTrackingView(d, o.trackingToken))!.order.canReview).toBe(true);
    await submitReview({ token: o.trackingToken, rating: 4, comment: 'حلو', items: [{ productId, rating: 5 }, { productId: crypto.randomUUID(), rating: 1 }] });
    await expectCode(submitReview({ token: o.trackingToken, rating: 1 }), 'CONFLICT');
    const view = (await loadTrackingView(d, o.trackingToken))!;
    expect(view.order.canReview).toBe(false);
    expect(view.order.review).toMatchObject({ rating: 4, comment: 'حلو' });
    const [review] = await listReviews(d, restaurantId);
    expect(review.customerName).toBe('Rana');
    const before = (await restaurantRatings(d, [restaurantId])).get(restaurantId)!;
    await d.update(s.reviews).set({ isHidden: true }).where(eq(s.reviews.id, review.id));
    expect((await restaurantRatings(d, [restaurantId])).get(restaurantId)?.count ?? 0).toBe(before.count - 1);
  });
});

describe('support tickets', () => {
  it('reaches the restaurant of the order, not other restaurants; replies flip the status', async () => {
    const o = await createOrder('alrayez', { items: items(), customerName: 'Omar', customerPhone: phone(), paymentMethod: 'CASH' }, key());
    const { token } = await createTicket({ orderToken: o.trackingToken, category: 'ORDER', message: 'المشروب ناقص من الطلب' });
    const [ticket] = (await listTickets(d, { restaurantId })).filter((x) => x.orderNumber === o.orderNumber);
    expect(ticket.status).toBe('OPEN');
    expect(await ticketForStaff(ticket.id, owner)).not.toBeNull();
    const outsider = { platformPermissions: new Set<string>(), storePermissions: new Map([[crypto.randomUUID(), new Set(['support.manage'])]]) };
    expect(await ticketForStaff(ticket.id, outsider as never)).toBeNull();
    await expectCode(staffReply({ ticketId: ticket.id, body: 'x y', actor: { userId: owner.user.id, name: 'x', auth: outsider as never } }), 'NOT_FOUND');
    await staffReply({ ticketId: ticket.id, body: 'آسفين، هنرجعلك تمنه', actor: { userId: owner.user.id, name: owner.user.name, auth: owner } });
    expect((await d.select().from(s.supportTickets).where(eq(s.supportTickets.id, ticket.id)))[0].status).toBe('ANSWERED');
    await customerReply(token, 'تمام شكرًا');
    expect((await d.select().from(s.supportTickets).where(eq(s.supportTickets.id, ticket.id)))[0].status).toBe('OPEN');
    await expectCode(createTicket({ category: 'APP', message: 'الموقع بطيء جدًا', customerName: 'Ali' }), 'VALIDATION');
  });
});

describe('delegation guard', () => {
  it('stops a partial admin from granting what they lack or touching a stronger account', async () => {
    const partial = { user: { id: crypto.randomUUID(), name: 'p', email: 'p@x' }, isPlatform: true, platformPermissions: new Set(['platform.users', 'platform.support']), storePermissions: new Map() } as unknown as AuthContext;
    expect(() => assertCanGrant(partial, ['platform.support'])).not.toThrow();
    expect(() => assertCanGrant(partial, ['platform.settings'])).toThrow();
    await expect(assertOutranks(d, partial, admin.user.id)).rejects.toThrow();
    await expect(assertOutranks(d, admin, partial.user.id)).resolves.toBeUndefined();
  });
});

describe('close of day', () => {
  it('splits completed sales by payment method and flags open work', async () => {
    const from = new Date(Date.now() - 60_000);
    const cash = await createOrder('alrayez', { items: items(), customerName: 'D', customerPhone: phone(), paymentMethod: 'CASH' }, key());
    await deliverCash(cash.orderId);
    const open = await createOrder('alrayez', { items: items(), customerName: 'E', customerPhone: phone(), paymentMethod: 'CASH' }, key());
    const [row] = await dailyClose(d, from, new Date(Date.now() + 60_000), restaurantId);
    expect(row.cashSales).toBeGreaterThanOrEqual((await orderRow(cash.orderId)).total);
    expect(row.stillOpen).toBeGreaterThanOrEqual(1);
    await applyOrderAction({ orderId: open.orderId, action: 'CANCEL', actor: staff(owner), payload: { reason: 'end' } });
  });
});
