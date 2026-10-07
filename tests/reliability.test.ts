import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { Db } from '@/server/db';
import * as s from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/authz';
import { createOrder, quote } from '@/server/services/checkout';
import { applyOrderAction, expireUnpaidOrder, type ActionActor } from '@/server/services/order-actions';
import { loadTrackingView } from '@/server/services/order-views';
import { getActiveLoad, getQueueConfig } from '@/server/services/store';
import { merchantSync } from '@/server/services/sync';
import { prepMinutesForLoad } from '@/lib/domain/queue';
import { AppError } from '@/server/errors';
import type { CreateOrderInput } from '@/lib/validation';
import { bootstrapRestaurant, type DemoSeedResult } from '@/server/seed';
import { authFor, setupTestDb } from './helpers/db';

let d: Db, client: PGlite, demo: DemoSeedResult;
let cashier: AuthContext, kitchen: AuthContext;
const customer: ActionActor = { type: 'CUSTOMER', label: 'customer' };
const actor = (auth: AuthContext): ActionActor => ({ type: 'USER', userId: auth.user.id, label: auth.user.name, auth });
const key = () => `reliability-${crypto.randomUUID()}`;
const input = (quantity = 1, extra: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
  customerName: 'أحمد', customerPhone: '01012345678', paymentMethod: 'INSTAPAY',
  items: [{ productId: demo.productIds['Chicken Shawarma Sandwich'], variantId: demo.variantIds['Chicken Shawarma Sandwich:Regular'], addonIds: [], quantity }],
  ...extra,
});
const failsWith = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);

beforeAll(async () => {
  ({ d, client, demo } = await setupTestDb());
  cashier = await authFor(d, 'cashier@alrayez.test');
  kitchen = await authFor(d, 'kitchen@alrayez.test');
  const config = await getQueueConfig(d, demo.restaurantId);
  await d.update(s.queueConfigs).set({ config: { ...config, maxAcceptedLoad: 0 } }).where(eq(s.queueConfigs.restaurantId, demo.restaurantId));
});
afterAll(async () => { await client.close(); });

describe('ordering reliability regressions', () => {
  it('keeps the original restaurant identity when its slug is reassigned during checkout', async () => {
    const other = await bootstrapRestaurant(d, { slug: 'slug-reassignment-test', nameAr: 'مطعم آخر', nameEn: 'Other restaurant' });
    const originalTransaction = d.transaction.bind(d);
    const transaction = vi.spyOn(d, 'transaction').mockImplementationOnce(async (callback, config) => {
      await d.update(s.restaurants).set({ slug: 'alrayez-renamed' }).where(eq(s.restaurants.id, demo.restaurantId));
      await d.update(s.restaurants).set({ slug: 'alrayez' }).where(eq(s.restaurants.id, other.id));
      return originalTransaction(callback, config);
    });
    try {
      const created = await createOrder('alrayez', input(), key());
      const [row] = await d.select().from(s.orders).where(eq(s.orders.id, created.orderId));
      const [point] = await d.select().from(s.deliveryPoints).where(eq(s.deliveryPoints.id, row.deliveryPointId!));
      expect(row.restaurantId).toBe(demo.restaurantId);
      expect(point.restaurantId).toBe(demo.restaurantId);
    } finally {
      transaction.mockRestore();
      await d.update(s.restaurants).set({ slug: 'slug-reassignment-test' }).where(eq(s.restaurants.id, other.id));
      await d.update(s.restaurants).set({ slug: 'alrayez' }).where(eq(s.restaurants.id, demo.restaurantId));
    }
  });

  it('does not expose legacy unsafe payment URLs to the tracking page', async () => {
    const created = await createOrder('alrayez', input(), key());
    const [instapay] = await d.select().from(s.restaurantPaymentMethods).where(and(
      eq(s.restaurantPaymentMethods.restaurantId, demo.restaurantId), eq(s.restaurantPaymentMethods.method, 'INSTAPAY')));
    try {
      for (const link of ['javascript:alert(1)', 'data:text/html,hello', 'https://name:password@example.com/pay', '/pay', 'not-a-url']) {
        await d.update(s.restaurantPaymentMethods).set({ config: { ...instapay.config, link } }).where(eq(s.restaurantPaymentMethods.id, instapay.id));
        expect((await loadTrackingView(d, created.trackingToken))!.instapay!.link).toBeNull();
      }
      await d.update(s.restaurantPaymentMethods).set({ config: { ...instapay.config, link: 'https://pay.example.com/order' } }).where(eq(s.restaurantPaymentMethods.id, instapay.id));
      expect((await loadTrackingView(d, created.trackingToken))!.instapay!.link).toBe('https://pay.example.com/order');
    } finally {
      await d.update(s.restaurantPaymentMethods).set({ config: instapay.config }).where(eq(s.restaurantPaymentMethods.id, instapay.id));
    }
  });

  it('replays concurrent checkout retries even when the first order uses the final promo allowance', async () => {
    const [promo] = await d.select().from(s.promotions).where(eq(s.promotions.code, 'WELCOME10'));
    const [before] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
    await d.update(s.promotions).set({ usageLimit: promo.usedCount + 1 }).where(eq(s.promotions.id, promo.id));
    const idempotencyKey = key();
    try {
      const results = await Promise.all(Array.from({ length: 5 }, () => createOrder('alrayez', input(3, { promoCode: 'WELCOME10' }), idempotencyKey)));
      expect(new Set(results.map((o) => o.orderId)).size).toBe(1);
      expect(results.filter((o) => !o.replayed)).toHaveLength(1);
      const [after] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
      expect(after.orderSeq - before.orderSeq).toBe(1);
      expect(after.eventSeq - before.eventSeq).toBe(1);
    } finally {
      await d.update(s.promotions).set({ usageLimit: promo.usageLimit }).where(eq(s.promotions.id, promo.id));
    }
  });

  it('quotes the actual cart load and selected pickup travel time, then saves a provisional ETA', async () => {
    const [point] = await d.select().from(s.deliveryPoints).where(and(eq(s.deliveryPoints.restaurantId, demo.restaurantId), eq(s.deliveryPoints.kind, 'DELIVERY')));
    const cfg = await getQueueConfig(d, demo.restaurantId);
    const { load } = await getActiveLoad(d, demo.restaurantId);
    await d.update(s.deliveryPoints).set({ extraMinutes: 6 }).where(eq(s.deliveryPoints.id, point.id));
    try {
      const request = input(40, { deliveryPointId: point.id });
      const q = await quote('alrayez', request);
      expect(q.etaMinutes).toBe(prepMinutesForLoad(load + 40, cfg) + cfg.deliveryMinutes + 6);
      const created = await createOrder('alrayez', request, key());
      const view = (await loadTrackingView(d, created.trackingToken))!;
      expect(view.order.confirmedAt).toBeNull();
      expect(view.order.estimatedArrivalAt! - view.order.createdAt).toBe(q.etaMinutes * 60_000);
      expect(view.order.estimatedReadyAt).toBeGreaterThan(view.order.createdAt);
    } finally {
      await d.update(s.deliveryPoints).set({ extraMinutes: point.extraMinutes }).where(eq(s.deliveryPoints.id, point.id));
    }
  });

  it('expires a public tracking order while no merchant device is polling', async () => {
    const old = await createOrder('alrayez', input(), key(), new Date(Date.now() - 30 * 60_000));
    const view = (await loadTrackingView(d, old.trackingToken))!;
    expect(view.order.status).toBe('CANCELLED');
    expect(view.order.cancelReason).toBe('انتهت مهلة الدفع');
    expect(view.order.paymentDeadlineAt).toBeNull();
  });

  it('refuses a transfer reported after its deadline', async () => {
    const old = await createOrder('alrayez', input(), key(), new Date(Date.now() - 30 * 60_000));
    await failsWith(applyOrderAction({ orderId: old.orderId, action: 'SUBMIT_PAYMENT', actor: customer }), 'CONFLICT');
    expect(await expireUnpaidOrder(old.orderId)).toBe(true);
  });

  it('honors unlimited payment time and starts a new window after staff reject a transfer', async () => {
    await d.update(s.restaurants).set({ unpaidTimeoutMinutes: 0 }).where(eq(s.restaurants.id, demo.restaurantId));
    const old = await createOrder('alrayez', input(), key(), new Date(Date.now() - 30 * 60_000));
    const unlimited = (await loadTrackingView(d, old.trackingToken))!;
    expect(unlimited.order.status).toBe('AWAITING_PAYMENT');
    expect(unlimited.order.paymentDeadlineAt).toBeNull();
    await d.update(s.restaurants).set({ unpaidTimeoutMinutes: 20 }).where(eq(s.restaurants.id, demo.restaurantId));

    const created = await createOrder('alrayez', input(), key(), new Date(Date.now() - 19 * 60_000));
    const [original] = await d.select().from(s.orders).where(eq(s.orders.id, created.orderId));
    await applyOrderAction({ orderId: created.orderId, action: 'SUBMIT_PAYMENT', actor: customer });
    const rejectedAt = new Date();
    await applyOrderAction({ orderId: created.orderId, action: 'REJECT_PAYMENT', actor: actor(cashier), now: rejectedAt });
    const view = (await loadTrackingView(d, created.trackingToken))!;
    expect(view.order.paymentDeadlineAt).toBe(rejectedAt.getTime() + 20 * 60_000);
    expect(await expireUnpaidOrder(created.orderId, new Date(rejectedAt.getTime() + 2 * 60_000))).toBe(false);
    // The status is awaiting payment again, but a stale job still must not cancel the new window.
    await failsWith(applyOrderAction({ orderId: created.orderId, action: 'CANCEL', actor: { type: 'SYSTEM', label: 'payment-timeout' },
      expectedStatus: 'AWAITING_PAYMENT', expectedVersion: original.version }), 'INVALID_TRANSITION');
  });

  it('binds a repeated action UUID to its original order, payload and authorized user', async () => {
    const a = await createOrder('alrayez', input(), key());
    const b = await createOrder('alrayez', input(), key());
    const eventId = crypto.randomUUID();
    await applyOrderAction({ orderId: a.orderId, action: 'VERIFY_PAYMENT', actor: actor(cashier), clientEventId: eventId });
    expect((await applyOrderAction({ orderId: a.orderId, action: 'VERIFY_PAYMENT', actor: actor(cashier), clientEventId: eventId })).result).toBe('duplicate');
    await failsWith(applyOrderAction({ orderId: b.orderId, action: 'VERIFY_PAYMENT', actor: actor(cashier), clientEventId: eventId }), 'IDEMPOTENCY_MISMATCH');
    await failsWith(applyOrderAction({ orderId: a.orderId, action: 'VERIFY_PAYMENT', actor: actor(kitchen), clientEventId: eventId }), 'FORBIDDEN');
    await failsWith(applyOrderAction({ orderId: a.orderId, action: 'CANCEL', actor: actor(cashier), clientEventId: eventId }), 'IDEMPOTENCY_MISMATCH');
    await failsWith(applyOrderAction({ orderId: a.orderId, action: 'CANCEL', actor: { type: 'SYSTEM', label: 'payment-timeout' },
      expectedStatus: 'AWAITING_PAYMENT' }), 'INVALID_TRANSITION');
    const [unchanged] = await d.select().from(s.orders).where(eq(s.orders.id, b.orderId));
    expect(unchanged.status).toBe('AWAITING_PAYMENT');
  });

  it('serializes simultaneous confirmations before calculating the queue estimate', async () => {
    const a = await createOrder('alrayez', input(15), key());
    const b = await createOrder('alrayez', input(15), key());
    const { load } = await getActiveLoad(d, demo.restaurantId);
    const cfg = await getQueueConfig(d, demo.restaurantId);
    await Promise.all([a, b].map((o) => applyOrderAction({ orderId: o.orderId, action: 'VERIFY_PAYMENT', actor: actor(cashier) })));
    const rows = await d.select().from(s.orders).where(eq(s.orders.restaurantId, demo.restaurantId));
    const durations = [a, b].map((o) => {
      const row = rows.find((r) => r.id === o.orderId)!;
      return (row.estimatedReadyAt!.getTime() - row.confirmedAt!.getTime()) / 60_000;
    }).sort((x, y) => x - y);
    expect(durations).toEqual([prepMinutesForLoad(load + 15, cfg), prepMinutesForLoad(load + 30, cfg)].sort((x, y) => x - y));
  });

  it('a fresh bootstrap tells the terminal to discard stale cached orders', async () => {
    const sync = await merchantSync({ auth: kitchen, restaurantId: demo.restaurantId, deviceId: crypto.randomUUID(), cursor: 0 });
    expect(sync.reset).toBe(true);
    expect(sync.orders.every((o) => o.customerPhone === null)).toBe(true);
  });
});
