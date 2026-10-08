import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { priceCart, type PricingContext } from '@/lib/domain/pricing';
import { primaryActionFor } from '@/lib/domain/order-machine';
import type { CreateOrderInput } from '@/lib/validation';
import * as s from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { createCounterOrder, createOrder, quote, quoteCounterOrder } from '@/server/services/checkout';
import { applyOrderAction, type ActionActor } from '@/server/services/order-actions';
import { recordRefund } from '@/server/services/refunds';
import { loadOrderSnapshots, loadTrackingView } from '@/server/services/order-views';
import { loadPublicMenu } from '@/server/services/menu';
import { getActiveLoad, getQueueConfig } from '@/server/services/store';
import { financeByRestaurant, periodStats } from '@/server/services/stats';
import { authFor, setupTestDb } from './helpers/db';

let fixture: Awaited<ReturnType<typeof setupTestDb>>;
let owner: Awaited<ReturnType<typeof authFor>>, cashier: typeof owner, kitchen: typeof owner;
let productId: string, pickupId: string;
const key = () => `platform-fee-${crypto.randomUUID()}`;
const input = (overrides: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
  customerName: 'Fee test customer', customerPhone: '01012345678', paymentMethod: 'CASH', deliveryPointId: pickupId,
  items: [{ productId, quantity: 1, addonIds: [] }], ...overrides,
});
const staff = (auth: typeof owner) => ({ userId: auth.user.id, name: auth.user.name, auth });
const actor = (auth: typeof owner): ActionActor => ({ type: 'USER', userId: auth.user.id, label: auth.user.name, auth });
const rowFor = async (id: string) => (await fixture.d.select().from(s.orders).where(eq(s.orders.id, id)))[0];
const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
async function complete(id: string) {
  await applyOrderAction({ orderId: id, action: 'MARK_READY', actor: actor(kitchen) });
  await applyOrderAction({ orderId: id, action: 'COMPLETE', actor: actor(cashier) });
}

beforeAll(async () => {
  fixture = await setupTestDb();
  owner = await authFor(fixture.d, 'owner@alrayez.test');
  cashier = await authFor(fixture.d, 'cashier@alrayez.test');
  kitchen = await authFor(fixture.d, 'kitchen@alrayez.test');
  const [category] = await fixture.d.select().from(s.categories).where(eq(s.categories.restaurantId, fixture.demo.restaurantId));
  const [product] = await fixture.d.insert(s.products).values({ restaurantId: fixture.demo.restaurantId, categoryId: category.id, nameAr: 'صنف ١٠٠ جنيه', nameEn: 'One hundred pound item', basePrice: 10000, prepLoadUnits: 1 }).returning();
  productId = product.id;
  const [pickup] = await fixture.d.select().from(s.deliveryPoints).where(and(eq(s.deliveryPoints.restaurantId, fixture.demo.restaurantId), eq(s.deliveryPoints.kind, 'PICKUP')));
  pickupId = pickup.id;
});
afterAll(async () => { await fixture.client.close(); });

describe('customer funded online fees', () => {
  it('charges 105 for a 100 base item, gives the merchant 100 and the platform 5', async () => {
    const q = await quote('alrayez', input());
    expect(q).toMatchObject({ pricingMode: 'ONLINE_PLATFORM_FEE', subtotal: 10000, platformFeeBps: 500, platformFeeAmount: 500, total: 10500 });
    const o = await createOrder('alrayez', input(), key());
    const row = await rowFor(o.orderId);
    expect(row).toMatchObject({ pricingMode: 'ONLINE_PLATFORM_FEE', platformFeeAmount: 500, commissionAmount: 500, merchantNet: 10000, total: 10500, status: 'CONFIRMED', paymentStatus: 'CASH' });
    expect(row.confirmedAt).toEqual(row.createdAt);
    expect(row.estimatedPrepStartAt).toEqual(row.confirmedAt);
    expect(row.estimatedArrivalAt).toEqual(row.estimatedReadyAt);
    const [payment] = await fixture.d.select().from(s.payments).where(eq(s.payments.orderId, o.orderId));
    expect(payment.amount).toBe(10500);
    const events = await fixture.d.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, o.orderId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ toStatus: 'CONFIRMED', data: { autoAccepted: true, platformFeeAmount: 500 } });
    expect(primaryActionFor('CONFIRMED')).toBe('MARK_READY');
    const menu = (await loadPublicMenu(fixture.d, 'alrayez'))!;
    expect(menu.restaurant.platformFeeBps).toBe(500);
    expect(menu.products.find((p) => p.id === productId)?.basePrice).toBe(10000);
    await complete(o.orderId);
  });

  it('quotes and creates counter orders at base price, regardless of a legacy commission flag', async () => {
    await fixture.d.update(s.restaurants).set({ counterCommissionEnabled: true }).where(eq(s.restaurants.id, fixture.demo.restaurantId));
    const q = await quoteCounterOrder(fixture.demo.restaurantId, input(), cashier);
    expect(q).toMatchObject({ pricingMode: 'COUNTER_NO_FEE', platformFeeBps: 0, platformFeeAmount: 0, total: 10000 });
    const manualPromoQuote = await quoteCounterOrder(fixture.demo.restaurantId, { ...input(), promoCode: 'WELCOME10' }, cashier);
    expect(manualPromoQuote).toMatchObject({ discount: 0, platformFeeAmount: 0, total: 10000 });
    const o = await createCounterOrder(fixture.demo.restaurantId, input(), key(), staff(cashier));
    expect(await rowFor(o.orderId)).toMatchObject({ channel: 'COUNTER', pricingMode: 'COUNTER_NO_FEE', platformFeeAmount: 0, commissionBps: 0, commissionAmount: 0, merchantNet: 10000, total: 10000 });
    const audits = await fixture.d.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, o.orderId), eq(s.auditLogs.action, 'order.counter_created')));
    expect(audits).toHaveLength(1);
    expect(audits[0].actorUserId).toBe(cashier.user.id);
    await expectCode(quoteCounterOrder(fixture.demo.restaurantId, input(), kitchen), 'FORBIDDEN');
    await expectCode(quoteCounterOrder(crypto.randomUUID(), input(), cashier), 'FORBIDDEN');
    await complete(o.orderId);
  });

  it('prices variants and addons, applies the discount first, and excludes delivery from the percentage', () => {
    const context: PricingContext = {
      pricingMode: 'ONLINE_PLATFORM_FEE', commissionBps: 500, now: new Date(), deliveryFee: 500, minOrderAmount: 0,
      products: new Map([['p', { id: 'p', nameAr: 'صنف', nameEn: 'Item', basePrice: 10000, isActive: true, isAvailable: true, prepLoadUnits: 1, addonGroupIds: ['g'], variants: [{ id: 'v', nameAr: 'حجم', nameEn: 'Size', price: 2000, isAvailable: true, prepLoadUnits: null }] }]]),
      addonGroups: new Map([['g', { id: 'g', nameAr: 'إضافات', nameEn: 'Extras', minSelect: 0, maxSelect: 1, addons: [{ id: 'a', nameAr: 'إضافة', nameEn: 'Addon', price: 333, isAvailable: true }] }]]),
      promotions: [{ id: 'discount', name: 'Discount', code: null, type: 'FIXED', value: 1000, productId: null, autoApply: true, minSubtotal: 0, maxDiscount: null, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, isActive: true }],
    };
    const cart = priceCart([{ productId: 'p', variantId: 'v', addonIds: ['a'], quantity: 3 }], context);
    expect(cart).toMatchObject({ subtotal: 6999, discount: 1000, platformFeeAmount: 300, total: 6799, merchantNet: 6499 });
    expect(cart.total).toBe(cart.merchantNet + cart.commissionAmount);
    const counter = priceCart([{ productId: 'p', variantId: 'v', addonIds: ['a'], quantity: 3 }], { ...context, pricingMode: 'COUNTER_NO_FEE' });
    expect(counter).toMatchObject({ platformFeeAmount: 0, commissionAmount: 0, total: 6499, merchantNet: 6499 });
    const free = priceCart([{ productId: 'p', variantId: 'v', quantity: 1 }], { ...context, promotions: [{ ...context.promotions[0], value: 50000 }] });
    expect(free).toMatchObject({ discount: 2000, platformFeeAmount: 0, total: 500, merchantNet: 500 });
  });

  it('freezes price, fee rate and merchant share when prices or platform settings change', async () => {
    const requestKey = key(), body = input();
    const o = await createOrder('alrayez', body, requestKey);
    await fixture.d.update(s.restaurants).set({ commissionBps: 1000 }).where(eq(s.restaurants.id, fixture.demo.restaurantId));
    await fixture.d.update(s.products).set({ basePrice: 12000 }).where(eq(s.products.id, productId));
    try {
      expect((await quote('alrayez', body)).total).toBe(13200);
      expect((await createOrder('alrayez', body, requestKey)).total).toBe(10500);
      const row = await rowFor(o.orderId);
      expect(row).toMatchObject({ commissionBps: 500, platformFeeAmount: 500, merchantNet: 10000, total: 10500 });
      const [snap] = await loadOrderSnapshots(fixture.d, [o.orderId], { includePhone: true });
      const tracking = (await loadTrackingView(fixture.d, o.trackingToken))!;
      for (const view of [snap, tracking.order]) expect(view).toMatchObject({ pricingMode: 'ONLINE_PLATFORM_FEE', platformFeeAmount: 500, platformFeeBps: 500, total: 10500 });
    } finally {
      await fixture.d.update(s.restaurants).set({ commissionBps: 500 }).where(eq(s.restaurants.id, fixture.demo.restaurantId));
      await fixture.d.update(s.products).set({ basePrice: 10000 }).where(eq(s.products.id, productId));
    }
    await complete(o.orderId);
  });

  it('cannot replay counter keys as a guest or a different staff member to bypass the fee or obtain the token', async () => {
    const requestKey = key(), body = input();
    const counter = await createCounterOrder(fixture.demo.restaurantId, body, requestKey, staff(cashier));
    await expectCode(createOrder('alrayez', { ...body, source: 'counter' }, requestKey), 'FORBIDDEN');
    await expectCode(createCounterOrder(fixture.demo.restaurantId, body, requestKey, staff(owner)), 'FORBIDDEN');
    expect((await createCounterOrder(fixture.demo.restaurantId, body, requestKey, staff(cashier))).orderId).toBe(counter.orderId);
    const onlineKey = key();
    const online = await createOrder('alrayez', body, onlineKey);
    await expectCode(createCounterOrder(fixture.demo.restaurantId, body, onlineKey, staff(cashier)), 'FORBIDDEN');
    expect(await rowFor(counter.orderId)).toMatchObject({ commissionAmount: 0, total: 10000 });
    expect(await rowFor(online.orderId)).toMatchObject({ commissionAmount: 500, total: 10500 });
    await complete(counter.orderId); await complete(online.orderId);
  });
});

describe('frozen refund and ledger allocation', () => {
  it('reverses the exact fee and merchant amount across split refunds, with no rounding drift', async () => {
    const o = await createOrder('alrayez', input(), key());
    await complete(o.orderId);
    const from = new Date(Date.now() - 3_600_000), to = new Date(Date.now() + 3_600_000);
    const before = await periodStats(fixture.d, from, to, fixture.demo.restaurantId);
    for (let i = 0; i < 3; i++) await recordRefund({ orderId: o.orderId, amount: 3500, method: 'CASH', actor: staff(owner) });
    const refunds = await fixture.d.select().from(s.refunds).where(eq(s.refunds.orderId, o.orderId)).orderBy(asc(s.refunds.createdAt));
    expect(refunds.map((r) => r.commissionReversed)).toEqual([167, 166, 167]);
    expect(refunds.reduce((sum, r) => sum + r.amount - r.commissionReversed, 0)).toBe(10000);
    const after = await periodStats(fixture.d, from, to, fixture.demo.restaurantId);
    expect(after.sales).toBe(before.sales - 10500);
    expect(after.commission).toBe(before.commission - 500);
    expect(after.merchantNet).toBe(before.merchantNet - 10000);
    expect(after.sales).toBe(after.merchantNet + after.commission);
    const ledger = (await financeByRestaurant(fixture.d, from, to)).find((row) => row.restaurantId === fixture.demo.restaurantId)!;
    expect(ledger.period.commission).toBe(after.commission);
  });

  it('refunds a counter order without ever reversing platform revenue', async () => {
    const o = await createCounterOrder(fixture.demo.restaurantId, input(), key(), staff(cashier));
    await complete(o.orderId);
    await recordRefund({ orderId: o.orderId, amount: 3333, method: 'CASH', actor: staff(owner) });
    await recordRefund({ orderId: o.orderId, method: 'CASH', actor: staff(owner) });
    const refunds = await fixture.d.select().from(s.refunds).where(eq(s.refunds.orderId, o.orderId));
    expect(refunds.every((r) => r.commissionReversed === 0)).toBe(true);
    expect(refunds.reduce((sum, r) => sum + r.amount, 0)).toBe(10000);
  });

  it('preserves legacy snapshots and prior refund rows while reversing only their remaining commission', async () => {
    // This is an existing order shape from before customer-funded fees: merchant net is 95, not 100.
    const o = await createOrder('alrayez', input(), key());
    await complete(o.orderId);
    await fixture.d.update(s.orders).set({ pricingMode: 'LEGACY_COMMISSION', platformFeeAmount: 0, total: 10000, commissionAmount: 500, merchantNet: 9500, refundedTotal: 3333, paymentStatus: 'PARTIALLY_REFUNDED' }).where(eq(s.orders.id, o.orderId));
    await fixture.d.update(s.payments).set({ amount: 10000, status: 'PARTIALLY_REFUNDED' }).where(eq(s.payments.orderId, o.orderId));
    const [historicalRefund] = await fixture.d.insert(s.refunds).values({ restaurantId: fixture.demo.restaurantId, orderId: o.orderId, status: 'COMPLETED', amount: 3333, commissionReversed: 167, method: 'CASH', decidedAt: new Date() }).returning();
    await recordRefund({ orderId: o.orderId, method: 'CASH', actor: staff(owner) });
    const rows = await fixture.d.select().from(s.refunds).where(eq(s.refunds.orderId, o.orderId));
    expect(rows.find((row) => row.id === historicalRefund.id)).toEqual(historicalRefund);
    expect(rows.reduce((sum, row) => sum + row.commissionReversed, 0)).toBe(500);
    expect(rows.reduce((sum, row) => sum + row.amount - row.commissionReversed, 0)).toBe(9500);
    expect(await rowFor(o.orderId)).toMatchObject({ pricingMode: 'LEGACY_COMMISSION', platformFeeAmount: 0, total: 10000, merchantNet: 9500, commissionAmount: 500 });
  });
});

describe('automatic cash acceptance capacity', () => {
  it('admits exactly five simultaneous cash orders for five kitchen slots, then frees capacity on READY', async () => {
    const { d, demo } = fixture;
    const config = await getQueueConfig(d, demo.restaurantId);
    const active = await getActiveLoad(d, demo.restaurantId);
    expect(active.count).toBe(0);
    const [before] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
    await d.update(s.queueConfigs).set({ config: { ...config, maxAcceptedLoad: 5, maxActiveOrders: 5, autoPause: true } }).where(eq(s.queueConfigs.restaurantId, demo.restaurantId));
    try {
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => createOrder('alrayez', input(), key())));
      const admitted = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const refused = results.filter((r) => r.status === 'rejected').map((r) => r.reason as AppError);
      expect(admitted).toHaveLength(5);
      expect(refused).toHaveLength(15);
      expect(refused.every((e) => e instanceof AppError && e.code === 'STORE_PAUSED')).toBe(true);
      expect(admitted.every((o) => o.status === 'CONFIRMED')).toBe(true);
      const [after] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
      expect(after.orderSeq - before.orderSeq).toBe(5);
      expect(after.eventSeq - before.eventSeq).toBe(5);
      await applyOrderAction({ orderId: admitted[0].orderId, action: 'MARK_READY', actor: actor(kitchen) });
      // One slot remains: an order needing two units must be rejected before anything is written.
      await expectCode(createOrder('alrayez', input({ items: [{ productId, quantity: 2, addonIds: [] }] }), key()), 'STORE_PAUSED');
      expect((await createOrder('alrayez', input(), key())).status).toBe('CONFIRMED');
      await expectCode(createCounterOrder(demo.restaurantId, input(), key(), staff(cashier)), 'STORE_PAUSED');
    } finally {
      await d.update(s.queueConfigs).set({ config }).where(eq(s.queueConfigs.restaurantId, demo.restaurantId));
    }
  });
});
