import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/server/db';
import * as s from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/authz';
import { createOrder } from '@/server/services/checkout';
import { applyOrderAction, expireUnpaidOrders, resetExpiryThrottle, type ActionActor } from '@/server/services/order-actions';
import { loadOrderSnapshots, loadTrackingView } from '@/server/services/order-views';
import { merchantSync } from '@/server/services/sync';
import { getActiveLoad, getQueueConfig } from '@/server/services/store';
import { assignRole, bootstrapRestaurant, ensureUser, type DemoSeedResult } from '@/server/seed';
import { prepMinutesForLoad } from '@/lib/domain/queue';
import type { CreateOrderInput } from '@/lib/validation';
import { AppError } from '@/server/errors';
import { authFor, setupTestDb, TEST_PASSWORD } from './helpers/db';

let d: Db;
let demo: DemoSeedResult;
let owner: AuthContext, cashier: AuthContext, kitchen: AuthContext, delivery: AuthContext, admin: AuthContext;
let keyCounter = 0;
const key = () => `test-key-${++keyCounter}-${Math.random().toString(36).slice(2)}`;
const SLUG = 'alrayez';

const user = (auth: AuthContext, deviceId?: string): ActionActor => ({ type: 'USER', userId: auth.user.id, label: auth.user.name, auth, deviceId });
const customer: ActionActor = { type: 'CUSTOMER', label: 'customer' };

function input(over: Partial<CreateOrderInput> = {}, qty = 3): CreateOrderInput {
  return {
    items: [{ productId: demo.productIds['Chicken Shawarma Sandwich'], variantId: demo.variantIds['Chicken Shawarma Sandwich:Regular'], addonIds: [], quantity: qty }],
    customerName: 'Ahmed',
    customerPhone: '01012345678',
    paymentMethod: 'INSTAPAY',
    ...over,
  };
}

async function confirmedOrder(qty = 3) {
  const o = await createOrder(SLUG, input({}, qty), key());
  await applyOrderAction({ orderId: o.orderId, action: 'VERIFY_PAYMENT', actor: user(cashier) });
  return o;
}

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  ({ d, demo } = await setupTestDb());
  owner = await authFor(d, 'owner@alrayez.test');
  cashier = await authFor(d, 'cashier@alrayez.test');
  kitchen = await authFor(d, 'kitchen@alrayez.test');
  delivery = await authFor(d, 'delivery@alrayez.test');
  admin = await authFor(d, 'admin@test.local');
});

describe('order creation', () => {
  it('creates an order exactly once per Idempotency-Key (sequential and concurrent)', async () => {
    const k = key();
    const a = await createOrder(SLUG, input(), k);
    const b = await createOrder(SLUG, input(), k);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.orderId).toBe(a.orderId);
    expect(a.orderNumber).toMatch(/^[A-Z]\d{3}$/);
    expect(a.total).toBe(3 * 6000);
    expect(a.status).toBe('AWAITING_PAYMENT');

    const k2 = key();
    const results = await Promise.all(Array.from({ length: 5 }, () => createOrder(SLUG, input(), k2)));
    expect(new Set(results.map((r) => r.orderId)).size).toBe(1);
    const rows = await d.select().from(s.orders).where(eq(s.orders.idempotencyKey, k2));
    expect(rows).toHaveLength(1);
  });

  it('refuses to reuse a key for a different order', async () => {
    const k = key();
    await createOrder(SLUG, input(), k);
    await expectAppError(createOrder(SLUG, input({}, 4), k), 'IDEMPOTENCY_MISMATCH');
  });

  it('snapshots prices and commission at order time', async () => {
    const o = await createOrder(SLUG, input(), key());
    await d.update(s.productVariants).set({ price: 9000 }).where(eq(s.productVariants.id, demo.variantIds['Chicken Shawarma Sandwich:Regular']));
    await d.update(s.restaurants).set({ commissionBps: 1000 }).where(eq(s.restaurants.id, demo.restaurantId));
    const [snap] = await loadOrderSnapshots(d, [o.orderId], { includePhone: true });
    expect(snap.items[0].unitPrice).toBe(6000);
    expect(snap.total).toBe(18000);
    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(row.commissionBps).toBe(500);
    expect(row.commissionAmount).toBe(900);
    expect(row.merchantNet).toBe(17100);
    // restore
    await d.update(s.productVariants).set({ price: 6000 }).where(eq(s.productVariants.id, demo.variantIds['Chicken Shawarma Sandwich:Regular']));
    await d.update(s.restaurants).set({ commissionBps: 500 }).where(eq(s.restaurants.id, demo.restaurantId));
  });

  it('refuses orders while paused or at capacity', async () => {
    await d.update(s.restaurants).set({ orderingStatus: 'PAUSED' }).where(eq(s.restaurants.id, demo.restaurantId));
    await expectAppError(createOrder(SLUG, input(), key()), 'STORE_PAUSED');
    await d.update(s.restaurants).set({ orderingStatus: 'CLOSED' }).where(eq(s.restaurants.id, demo.restaurantId));
    await expectAppError(createOrder(SLUG, input(), key()), 'STORE_CLOSED');
    await d.update(s.restaurants).set({ orderingStatus: 'OPEN' }).where(eq(s.restaurants.id, demo.restaurantId));

    await confirmedOrder(2);
    const cfg = await getQueueConfig(d, demo.restaurantId);
    await d.update(s.queueConfigs).set({ config: { ...cfg, maxAcceptedLoad: 1 } }).where(eq(s.queueConfigs.restaurantId, demo.restaurantId));
    await expectAppError(createOrder(SLUG, input(), key()), 'STORE_PAUSED');
    await d.update(s.queueConfigs).set({ config: cfg }).where(eq(s.queueConfigs.restaurantId, demo.restaurantId));
  });

  it('enforces promo usage limits atomically', async () => {
    const [promo] = await d.select().from(s.promotions).where(eq(s.promotions.code, 'WELCOME10'));
    await d.update(s.promotions).set({ usageLimit: promo.usedCount + 1 }).where(eq(s.promotions.id, promo.id));
    const first = await createOrder(SLUG, input({ promoCode: 'welcome10' }, 2), key());
    expect(first.total).toBe(12000 - 1200);
    await expectAppError(createOrder(SLUG, input({ promoCode: 'WELCOME10' }, 2), key()), 'PROMO_INVALID');
  });

  it('rejects disabled payment methods and bad phones', async () => {
    await d
      .update(s.restaurantPaymentMethods)
      .set({ isEnabled: false })
      .where(and(eq(s.restaurantPaymentMethods.restaurantId, demo.restaurantId), eq(s.restaurantPaymentMethods.method, 'CASH')));
    await expectAppError(createOrder(SLUG, input({ paymentMethod: 'CASH' }), key()), 'PAYMENT_METHOD_DISABLED');
    await d
      .update(s.restaurantPaymentMethods)
      .set({ isEnabled: true })
      .where(and(eq(s.restaurantPaymentMethods.restaurantId, demo.restaurantId), eq(s.restaurantPaymentMethods.method, 'CASH')));
    await expectAppError(createOrder(SLUG, input({ customerPhone: '12345' }), key()), 'VALIDATION');
  });
});

describe('payment + kitchen flow', () => {
  it('runs InstaPay verification and computes the ETA from the active kitchen load', async () => {
    const o = await createOrder(SLUG, input(), key());
    await applyOrderAction({ orderId: o.orderId, action: 'SUBMIT_PAYMENT', actor: customer, payload: { reference: 'TX-991' } });
    await expectAppError(applyOrderAction({ orderId: o.orderId, action: 'VERIFY_PAYMENT', actor: user(kitchen) }), 'FORBIDDEN');

    const { load } = await getActiveLoad(d, demo.restaurantId);
    const cfg = await getQueueConfig(d, demo.restaurantId);
    const r = await applyOrderAction({ orderId: o.orderId, action: 'VERIFY_PAYMENT', actor: user(cashier) });
    expect(r.status).toBe('CONFIRMED');

    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(row.paymentStatus).toBe('PAYMENT_VERIFIED');
    const expectedPrep = prepMinutesForLoad(load + 3, cfg);
    expect((row.estimatedReadyAt!.getTime() - row.confirmedAt!.getTime()) / 60_000).toBe(expectedPrep);
    expect((row.estimatedArrivalAt!.getTime() - row.estimatedReadyAt!.getTime()) / 60_000).toBe(cfg.deliveryMinutes);

    const [payment] = await d.select().from(s.payments).where(eq(s.payments.orderId, o.orderId));
    expect(payment.reference).toBe('TX-991');
    expect(payment.verifiedByUserId).toBe(cashier.user.id);

    const view = await loadTrackingView(d, o.trackingToken);
    expect(view?.order.status).toBe('CONFIRMED');
    expect(view?.order.estimatedArrivalAt).toBe(row.estimatedArrivalAt!.getTime());

    const audits = await d.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, o.orderId), eq(s.auditLogs.action, 'order.verify_payment')));
    expect(audits).toHaveLength(1);
    expect(audits[0].actorUserId).toBe(cashier.user.id);
  });

  it('longer queue → longer ETA', async () => {
    await confirmedOrder(45); // big rush order
    const { load } = await getActiveLoad(d, demo.restaurantId);
    const cfg = await getQueueConfig(d, demo.restaurantId);
    const o = await confirmedOrder(3);
    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    const prep = (row.estimatedReadyAt!.getTime() - row.confirmedAt!.getTime()) / 60_000;
    expect(prep).toBe(prepMinutesForLoad(load + 3, cfg));
    expect(prep).toBeGreaterThan(cfg.basePrepMinutes);
  });

  it('customer cannot cancel after the payment was verified; cash orders need acceptance', async () => {
    const o = await confirmedOrder(1);
    await expectAppError(applyOrderAction({ orderId: o.orderId, action: 'CANCEL', actor: customer }), 'FORBIDDEN');
    await expectAppError(applyOrderAction({ orderId: o.orderId, action: 'CANCEL', actor: user(kitchen) }), 'FORBIDDEN');

    const cash = await createOrder(SLUG, input({ paymentMethod: 'CASH' }), key());
    expect(cash.status).toBe('CREATED');
    await expectAppError(applyOrderAction({ orderId: cash.orderId, action: 'START_PREPARING', actor: user(kitchen) }), 'INVALID_TRANSITION');
    expect((await applyOrderAction({ orderId: cash.orderId, action: 'ACCEPT', actor: user(cashier) })).status).toBe('CONFIRMED');
  });

  it('expires InstaPay orders that were never paid', async () => {
    const past = new Date(Date.now() - 45 * 60_000);
    const o = await createOrder(SLUG, input(), key(), past);
    resetExpiryThrottle();
    expect(await expireUnpaidOrders(demo.restaurantId, 20)).toBeGreaterThanOrEqual(1);
    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelReason).toBe('انتهت مهلة الدفع');
  });
});

describe('offline sync', () => {
  const deviceId = '7b0c6e1e-58a4-4f0b-9a52-3f0c1f2b9d11';

  it('applies offline actions exactly once and keeps their real time', async () => {
    // The order was placed 10 minutes ago; the kitchen marked it ready (offline) 4 minutes after that.
    const o = await createOrder(SLUG, input(), key(), new Date(Date.now() - 10 * 60_000));
    await applyOrderAction({ orderId: o.orderId, action: 'VERIFY_PAYMENT', actor: user(cashier) });
    const [created] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    const readyAt = new Date(created.createdAt.getTime() + 4 * 60_000);
    const eventId = crypto.randomUUID();

    await applyOrderAction({ orderId: o.orderId, action: 'START_PREPARING', actor: user(kitchen, deviceId), clientEventId: crypto.randomUUID() });
    const first = await applyOrderAction({ orderId: o.orderId, action: 'MARK_READY', actor: user(kitchen, deviceId), clientEventId: eventId, occurredAt: readyAt });
    const again = await applyOrderAction({ orderId: o.orderId, action: 'MARK_READY', actor: user(kitchen, deviceId), clientEventId: eventId, occurredAt: readyAt });
    expect(first.result).toBe('applied');
    expect(again.result).toBe('duplicate');
    expect(await d.select().from(s.orderEvents).where(eq(s.orderEvents.clientEventId, eventId))).toHaveLength(1);

    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(row.status).toBe('READY');
    expect(row.readyAt?.getTime()).toBe(readyAt.getTime());

    // A different device already did it → a new action is rejected (not retried forever).
    await expectAppError(
      applyOrderAction({ orderId: o.orderId, action: 'MARK_READY', actor: user(kitchen), clientEventId: crypto.randomUUID() }),
      'INVALID_TRANSITION',
    );
    // Future timestamps from a wrong device clock are clamped to server time.
    const future = new Date(Date.now() + 3_600_000);
    await applyOrderAction({ orderId: o.orderId, action: 'OUT_FOR_DELIVERY', actor: user(delivery), clientEventId: crypto.randomUUID(), occurredAt: future });
    const [row2] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(row2.outForDeliveryAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row2.assignedToUserId).toBe(delivery.user.id);
  });

  it('a device that missed events gets every changed order from its cursor', async () => {
    const boot = await merchantSync({ auth: owner, restaurantId: demo.restaurantId, deviceId, cursor: 0 });
    expect(boot.cursor).toBeGreaterThan(0);
    expect(boot.orders.length).toBeGreaterThan(0);

    // "Internet down": orders arrive on the server while the device is not listening.
    const missed1 = await createOrder(SLUG, input(), key());
    const missed2 = await confirmedOrder(2);

    const catchUp = await merchantSync({ auth: owner, restaurantId: demo.restaurantId, deviceId, cursor: boot.cursor });
    const ids = catchUp.orders.map((o) => o.id);
    expect(ids).toContain(missed1.orderId);
    expect(ids).toContain(missed2.orderId);
    expect(catchUp.cursor).toBeGreaterThan(boot.cursor);
    expect(catchUp.orders.find((o) => o.id === missed2.orderId)?.status).toBe('CONFIRMED');

    const idle = await merchantSync({ auth: owner, restaurantId: demo.restaurantId, deviceId, cursor: catchUp.cursor });
    expect(idle.orders).toHaveLength(0);

    const [dev] = await d.select().from(s.devices).where(eq(s.devices.id, deviceId));
    expect(dev.lastCursor).toBe(catchUp.cursor);

    const reset = await merchantSync({ auth: owner, restaurantId: demo.restaurantId, deviceId, cursor: catchUp.cursor + 10_000 });
    expect(reset.reset).toBe(true);
  });

  it('delivery staff only see ready orders and their own deliveries; kitchen sees no phone numbers', async () => {
    const sync = await merchantSync({ auth: delivery, restaurantId: demo.restaurantId, deviceId, cursor: 0 });
    for (const o of sync.orders) {
      expect(o.status === 'READY' || o.assignedToUserId === delivery.user.id).toBe(true);
    }
    const kitchenSync = await merchantSync({ auth: kitchen, restaurantId: demo.restaurantId, deviceId, cursor: 0 });
    expect(kitchenSync.orders.every((o) => o.customerPhone === null)).toBe(true);
    const cashierSync = await merchantSync({ auth: cashier, restaurantId: demo.restaurantId, deviceId, cursor: 0 });
    expect(cashierSync.orders.some((o) => o.customerPhone === '01012345678')).toBe(true);
  });
});

describe('permissions', () => {
  it('a merchant owner cannot touch another restaurant', async () => {
    const other = await bootstrapRestaurant(d, { slug: 'other-shop', nameAr: 'محل تاني', nameEn: 'Other Shop' });
    const u = await ensureUser(d, { email: 'owner2@test.local', name: 'Owner 2', password: TEST_PASSWORD });
    await assignRole(d, u.id, 'MERCHANT_OWNER', other.id);
    const owner2 = await authFor(d, 'owner2@test.local');

    const o = await createOrder(SLUG, input(), key());
    await expectAppError(applyOrderAction({ orderId: o.orderId, action: 'VERIFY_PAYMENT', actor: user(owner2) }), 'FORBIDDEN');
    await expectAppError(
      merchantSync({ auth: owner2, restaurantId: demo.restaurantId, deviceId: crypto.randomUUID(), cursor: 0 }),
      'FORBIDDEN',
    );
    // ...and a restaurant-scoped action is refused when the order belongs elsewhere.
    await expectAppError(
      applyOrderAction({ orderId: o.orderId, action: 'VERIFY_PAYMENT', actor: user(owner), restaurantId: other.id }),
      'NOT_FOUND',
    );
    expect(owner2.platformPermissions.size).toBe(0);
    expect(admin.platformPermissions.has('platform.finance')).toBe(true);
    expect(owner.platformPermissions.has('platform.finance')).toBe(false);
  });
});
