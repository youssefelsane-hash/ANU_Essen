import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorMayPerform, nextStatus, primaryActionFor } from '@/lib/domain/order-machine';
import { computeEta, DEFAULT_QUEUE_CONFIG } from '@/lib/domain/queue';
import type { CreateOrderInput } from '@/lib/validation';
import * as s from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { bootstrapRestaurant } from '@/server/seed';
import { createOrder, quote, type CreateOrderOptions } from '@/server/services/checkout';
import { applyOrderAction, type ActionActor } from '@/server/services/order-actions';
import { loadOrderSnapshots, loadTrackingView } from '@/server/services/order-views';
import { loadPublicMenu } from '@/server/services/menu';
import { merchantSync } from '@/server/services/sync';
import { authFor, setupTestDb } from './helpers/db';

let fixture: Awaited<ReturnType<typeof setupTestDb>>;
let cashier: Awaited<ReturnType<typeof authFor>>, kitchen: typeof cashier, courier: typeof cashier, owner: typeof cashier;
let pickupId: string, deliveryId: string;
const key = () => `fulfillment-${crypto.randomUUID()}`;
const input = (overrides: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
  customerName: 'Sam', customerPhone: '01012345678', paymentMethod: 'CASH', deliveryPointId: pickupId,
  items: [{ productId: fixture.demo.productIds['Chicken Shawarma Sandwich'], variantId: fixture.demo.variantIds['Chicken Shawarma Sandwich:Regular'], quantity: 1, addonIds: [] }],
  ...overrides,
});
const actor = (auth: typeof cashier): ActionActor => ({ type: 'USER', userId: auth.user.id, label: auth.user.name, auth });
const staffOptions = (auth: typeof cashier, cashReceived = false): CreateOrderOptions => ({ staff: { userId: auth.user.id, label: auth.user.name, auth }, cashReceived });
const err = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
const rowFor = async (id: string) => (await fixture.d.select().from(s.orders).where(eq(s.orders.id, id)))[0];

beforeAll(async () => {
  fixture = await setupTestDb();
  cashier = await authFor(fixture.d, 'cashier@alrayez.test');
  kitchen = await authFor(fixture.d, 'kitchen@alrayez.test');
  courier = await authFor(fixture.d, 'delivery@alrayez.test');
  owner = await authFor(fixture.d, 'owner@alrayez.test');
  const points = await fixture.d.select().from(s.deliveryPoints).where(eq(s.deliveryPoints.restaurantId, fixture.demo.restaurantId));
  pickupId = points.find((point) => point.fulfillmentType === 'PICKUP')!.id;
  deliveryId = points.find((point) => point.fulfillmentType === 'DELIVERY')!.id;
});
afterAll(async () => { await fixture.client.close(); });

describe('pickup and delivery domain', () => {
  it('keeps delivery transitions and uses a cashier hand-over for restaurant pickup', () => {
    expect(nextStatus('READY', 'COMPLETE', 'PICKUP')).toBe('COMPLETED');
    expect(primaryActionFor('READY', 'PICKUP')).toBe('COMPLETE');
    expect(nextStatus('READY', 'OUT_FOR_DELIVERY', 'PICKUP')).toBeNull();
    expect(nextStatus('OUT_FOR_DELIVERY', 'MARK_ARRIVED', 'PICKUP')).toBeNull();
    expect(nextStatus('READY', 'COMPLETE', 'DELIVERY')).toBeNull();
    expect(nextStatus('READY', 'OUT_FOR_DELIVERY')).toBe('OUT_FOR_DELIVERY');
    expect(actorMayPerform('USER', 'COMPLETE', 'READY', (p) => p === 'orders.accept', 'PICKUP')).toBe(true);
    expect(actorMayPerform('USER', 'COMPLETE', 'READY', (p) => p === 'orders.delivery', 'PICKUP')).toBe(false);
    expect(actorMayPerform('CUSTOMER', 'COMPLETE', 'READY', () => true, 'PICKUP')).toBe(false);
  });

  it('omits all travel time for pickup without mutating the restaurant queue configuration', () => {
    const at = new Date('2026-10-07T10:00:00Z');
    const pickup = computeEta({ confirmedAt: at, activeLoad: 4, orderLoad: 1, config: DEFAULT_QUEUE_CONFIG, extraDeliveryMinutes: 11, fulfillmentType: 'PICKUP' });
    const delivery = computeEta({ confirmedAt: at, activeLoad: 4, orderLoad: 1, config: DEFAULT_QUEUE_CONFIG, extraDeliveryMinutes: 11 });
    expect(pickup.arrivalAt).toEqual(pickup.readyAt);
    expect(pickup.deliveryMinutes).toBe(0);
    expect(pickup.prepMinutes).toBe(delivery.prepMinutes);
    expect(delivery.deliveryMinutes).toBe(DEFAULT_QUEUE_CONFIG.deliveryMinutes + 11);
    expect(DEFAULT_QUEUE_CONFIG.deliveryMinutes).toBe(2);
  });
});

describe('configured fulfillment points and snapshots', () => {
  it('bootstraps both choices with university delivery as the customer default', async () => {
    const menu = (await loadPublicMenu(fixture.d, 'alrayez'))!;
    expect(menu.deliveryPoints.filter((p) => p.fulfillmentType === 'PICKUP')).toHaveLength(1);
    expect(menu.deliveryPoints.find((p) => p.isDefault)?.fulfillmentType).toBe('DELIVERY');
    const restaurant = await bootstrapRestaurant(fixture.d, { slug: `new-defaults-${crypto.randomUUID()}`, nameAr: 'مطعم جديد', nameEn: 'New Restaurant' }, DEFAULT_QUEUE_CONFIG, { defaultPoints: true });
    const points = await fixture.d.select().from(s.deliveryPoints).where(eq(s.deliveryPoints.restaurantId, restaurant.id));
    expect(points).toHaveLength(2);
    expect(points.find((p) => p.fulfillmentType === 'DELIVERY')?.isDefault).toBe(true);
    expect(points.find((p) => p.fulfillmentType === 'PICKUP')?.deliveryFee).toBe(0);
  });

  it('backfills existing restaurants repeatedly without duplicating points or replacing configured defaults', async () => {
    const r = await bootstrapRestaurant(fixture.d, { slug: `legacy-points-${crypto.randomUUID()}`, nameAr: 'مطعم قديم', nameEn: 'Legacy Restaurant' });
    const [existing] = await fixture.d.insert(s.deliveryPoints).values({ restaurantId: r.id, nameAr: 'بوابة أخرى', nameEn: 'Existing Gate', isDefault: true, deliveryFee: 1500 }).returning();
    const empty = await bootstrapRestaurant(fixture.d, { slug: `empty-points-${crypto.randomUUID()}`, nameAr: 'مطعم بدون نقاط', nameEn: 'Empty Restaurant' });
    const sql = (await readFile('drizzle/0005_pickup_and_counter.sql', 'utf8')).split('-- Backfill defaults')[1].split('\n').slice(1).join('\n');
    await fixture.client.exec(sql);
    await fixture.client.exec(sql);
    const points = await fixture.d.select().from(s.deliveryPoints).where(eq(s.deliveryPoints.restaurantId, r.id));
    expect(points).toHaveLength(2);
    expect(points.find((p) => p.isDefault)?.id).toBe(existing.id);
    expect(points.find((p) => p.id === existing.id)?.deliveryFee).toBe(1500);
    const emptyPoints = await fixture.d.select().from(s.deliveryPoints).where(eq(s.deliveryPoints.restaurantId, empty.id));
    expect(emptyPoints).toHaveLength(2);
    expect(emptyPoints.find((p) => p.isDefault)?.fulfillmentType).toBe('DELIVERY');
  });

  it('quotes trusted server fees and ETA; even a misconfigured pickup never charges delivery', async () => {
    const { d } = fixture;
    await d.update(s.deliveryPoints).set({ deliveryFee: 3500, extraMinutes: 11 }).where(eq(s.deliveryPoints.id, pickupId));
    await d.update(s.deliveryPoints).set({ deliveryFee: 1500, extraMinutes: 6 }).where(eq(s.deliveryPoints.id, deliveryId));
    try {
      const pickup = await quote('alrayez', input());
      const delivery = await quote('alrayez', input({ deliveryPointId: deliveryId }));
      expect(pickup.fulfillmentType).toBe('PICKUP');
      expect(pickup.deliveryFee).toBe(0);
      expect(pickup.total).toBe(6000);
      expect(delivery.deliveryFee).toBe(1500);
      expect(delivery.total).toBe(7500);
      expect(delivery.etaMinutes - pickup.etaMinutes).toBe(8);
      const menu = (await loadPublicMenu(d, 'alrayez'))!;
      expect(menu.deliveryPoints.find((p) => p.id === pickupId)?.deliveryFee).toBe(0);
    } finally {
      await d.update(s.deliveryPoints).set({ deliveryFee: 0, extraMinutes: 0 }).where(eq(s.deliveryPoints.restaurantId, fixture.demo.restaurantId));
    }
  });

  it('freezes the fulfillment type and bilingual place name after point edits or deletion', async () => {
    const r = await createOrder('alrayez', input(), key());
    await fixture.d.update(s.deliveryPoints).set({ fulfillmentType: 'DELIVERY', nameAr: 'اسم جديد', nameEn: 'New Name', extraMinutes: 19 }).where(eq(s.deliveryPoints.id, pickupId));
    try {
      const [snapshot] = await loadOrderSnapshots(fixture.d, [r.orderId], { includePhone: true });
      const tracking = (await loadTrackingView(fixture.d, r.trackingToken))!;
      for (const o of [snapshot, tracking.order]) {
        expect(o.fulfillmentType).toBe('PICKUP');
        expect(o.deliveryPointNameEn).toBe('Collect from restaurant');
        expect(o.deliveryFee).toBe(0);
        expect(o.estimatedArrivalAt).toBe(o.estimatedReadyAt);
      }
      await applyOrderAction({ orderId: r.orderId, action: 'ACCEPT', actor: actor(cashier) });
      const row = await rowFor(r.orderId);
      expect(row.estimatedArrivalAt).toEqual(row.estimatedReadyAt);
    } finally {
      await fixture.d.update(s.deliveryPoints).set({ fulfillmentType: 'PICKUP', nameAr: 'استلام من المطعم', nameEn: 'Collect from restaurant', extraMinutes: 0 }).where(eq(s.deliveryPoints.id, pickupId));
    }
  });

  it('rejects another restaurant point and inactive points for quotes and checkout', async () => {
    const other = await bootstrapRestaurant(fixture.d, { slug: `foreign-point-${crypto.randomUUID()}`, nameAr: 'مطعم آخر', nameEn: 'Other Restaurant' });
    const [point] = await fixture.d.insert(s.deliveryPoints).values({ restaurantId: other.id, nameAr: 'استلام', nameEn: 'Pickup', fulfillmentType: 'PICKUP' }).returning();
    await err(quote('alrayez', input({ deliveryPointId: point.id })), 'VALIDATION');
    await err(createOrder('alrayez', input({ deliveryPointId: point.id }), key()), 'VALIDATION');
    await fixture.d.update(s.deliveryPoints).set({ isActive: false }).where(eq(s.deliveryPoints.id, pickupId));
    try { await err(createOrder('alrayez', input(), key()), 'VALIDATION'); }
    finally { await fixture.d.update(s.deliveryPoints).set({ isActive: true }).where(eq(s.deliveryPoints.id, pickupId)); }
  });
});

describe('pickup order lifecycle', () => {
  it('runs guest cash pickup through the kitchen and only allows a cashier to hand it over', async () => {
    const o = await createOrder('alrayez', input(), key());
    await applyOrderAction({ orderId: o.orderId, action: 'ACCEPT', actor: actor(cashier) });
    await applyOrderAction({ orderId: o.orderId, action: 'START_PREPARING', actor: actor(kitchen) });
    await applyOrderAction({ orderId: o.orderId, action: 'MARK_READY', actor: actor(kitchen) });
    await err(applyOrderAction({ orderId: o.orderId, action: 'OUT_FOR_DELIVERY', actor: actor(courier) }), 'INVALID_TRANSITION');
    await err(applyOrderAction({ orderId: o.orderId, action: 'MARK_ARRIVED', actor: actor(courier) }), 'INVALID_TRANSITION');
    await err(applyOrderAction({ orderId: o.orderId, action: 'COMPLETE', actor: actor(courier) }), 'FORBIDDEN');
    await err(applyOrderAction({ orderId: o.orderId, action: 'COMPLETE', actor: { type: 'CUSTOMER', label: 'customer' } }), 'FORBIDDEN');
    const sync = await merchantSync({ auth: courier, restaurantId: fixture.demo.restaurantId, deviceId: crypto.randomUUID(), cursor: 0 });
    expect(sync.orders.some((row) => row.id === o.orderId)).toBe(false);
    const eventId = crypto.randomUUID();
    const action = { orderId: o.orderId, action: 'COMPLETE' as const, actor: actor(cashier), clientEventId: eventId };
    expect((await applyOrderAction(action)).status).toBe('COMPLETED');
    expect((await applyOrderAction(action)).result).toBe('duplicate');
    const row = await rowFor(o.orderId);
    expect(row.paymentStatus).toBe('PAYMENT_VERIFIED');
    expect(row.outForDeliveryAt).toBeNull();
    expect(row.arrivedAt).toBeNull();
    const [payment] = await fixture.d.select().from(s.payments).where(eq(s.payments.orderId, o.orderId));
    expect(payment.verifiedByUserId).toBe(cashier.user.id);
    expect(payment.verifiedAt).not.toBeNull();
  });

  it('retains manual InstaPay verification for pickup orders', async () => {
    const o = await createOrder('alrayez', input({ paymentMethod: 'INSTAPAY' }), key());
    expect(o.status).toBe('AWAITING_PAYMENT');
    await applyOrderAction({ orderId: o.orderId, action: 'SUBMIT_PAYMENT', actor: { type: 'CUSTOMER', label: 'customer' }, payload: { reference: 'PICKUP-TRANSFER' } });
    await applyOrderAction({ orderId: o.orderId, action: 'VERIFY_PAYMENT', actor: actor(cashier) });
    await applyOrderAction({ orderId: o.orderId, action: 'MARK_READY', actor: actor(kitchen) });
    await applyOrderAction({ orderId: o.orderId, action: 'COMPLETE', actor: actor(cashier) });
    const row = await rowFor(o.orderId);
    expect(row.status).toBe('COMPLETED');
    expect(row.paymentStatus).toBe('PAYMENT_VERIFIED');
  });
});

describe('trusted staff counter creation', () => {
  it('creates and retries a prepaid cash order atomically, without requiring a walk-in phone', async () => {
    const requestKey = key(), body = input({ customerPhone: undefined }), options = staffOptions(cashier, true);
    const result = await createOrder('alrayez', body, requestKey, new Date(), undefined, options);
    expect(result.status).toBe('CONFIRMED');
    expect((await createOrder('alrayez', body, requestKey, new Date(), undefined, options)).orderId).toBe(result.orderId);
    const row = await rowFor(result.orderId);
    expect(row.customerPhone).toBeNull();
    expect(row.paymentStatus).toBe('PAYMENT_VERIFIED');
    expect(row.source).toBe('COUNTER');
    expect(row.cashReceivedAtCounter).toBe(true);
    expect(row.confirmedAt).not.toBeNull();
    expect(row.estimatedPrepStartAt).toEqual(row.confirmedAt);
    expect(row.estimatedArrivalAt).toEqual(row.estimatedReadyAt);
    const [event] = await fixture.d.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, row.id));
    expect(event.actorType).toBe('USER');
    expect(event.actorUserId).toBe(cashier.user.id);
    expect(event.data?.cashReceived).toBe(true);
    const audits = await fixture.d.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, row.id), eq(s.auditLogs.action, 'order.counter_created')));
    expect(audits).toHaveLength(1);
    const [payment] = await fixture.d.select().from(s.payments).where(eq(s.payments.orderId, row.id));
    expect(payment.verifiedByUserId).toBe(cashier.user.id);
    expect(payment.verifiedAt).not.toBeNull();
    await err(createOrder('alrayez', body, requestKey), 'IDEMPOTENCY_MISMATCH');
    await err(createOrder('alrayez', body, requestKey, new Date(), undefined, staffOptions(owner, true)), 'IDEMPOTENCY_MISMATCH');
    await err(createOrder('alrayez', body, requestKey, new Date(), undefined, staffOptions(cashier, false)), 'IDEMPOTENCY_MISMATCH');
    await applyOrderAction({ orderId: row.id, action: 'MARK_READY', actor: actor(kitchen) });
    await applyOrderAction({ orderId: row.id, action: 'COMPLETE', actor: actor(cashier) });
    expect((await rowFor(row.id)).paymentStatus).toBe('PAYMENT_VERIFIED');
  });

  it('supports pay-at-pickup cash and leaves counter InstaPay awaiting verification', async () => {
    const cash = await createOrder('alrayez', input({ customerPhone: undefined }), key(), new Date(), undefined, staffOptions(cashier));
    expect(cash.status).toBe('CONFIRMED');
    expect((await rowFor(cash.orderId)).paymentStatus).toBe('CASH');
    expect((await rowFor(cash.orderId)).cashReceivedAtCounter).toBe(false);
    await applyOrderAction({ orderId: cash.orderId, action: 'MARK_READY', actor: actor(kitchen) });
    await applyOrderAction({ orderId: cash.orderId, action: 'COMPLETE', actor: actor(cashier) });
    expect((await rowFor(cash.orderId)).paymentStatus).toBe('PAYMENT_VERIFIED');
    const instapay = await createOrder('alrayez', input({ customerPhone: undefined, paymentMethod: 'INSTAPAY' }), key(), new Date(), undefined, staffOptions(cashier));
    expect(instapay.status).toBe('AWAITING_PAYMENT');
    expect((await rowFor(instapay.orderId)).paymentStatus).toBe('UNPAID');
    await err(createOrder('alrayez', input({ paymentMethod: 'INSTAPAY' }), key(), new Date(), undefined, staffOptions(cashier, true)), 'FORBIDDEN');
  });

  it('requires current scoped staff permissions, phone for delivery, and the ordinary store admission checks', async () => {
    await err(createOrder('alrayez', input(), key(), new Date(), undefined, staffOptions(kitchen)), 'FORBIDDEN');
    await err(createOrder('alrayez', input(), key(), new Date(), undefined, staffOptions(courier)), 'FORBIDDEN');
    await err(createOrder('alrayez', input({ customerPhone: undefined }), key()), 'VALIDATION');
    await err(createOrder('alrayez', input({ customerPhone: undefined, deliveryPointId: deliveryId }), key(), new Date(), undefined, staffOptions(cashier)), 'VALIDATION');
    const noVerify = { ...cashier, platformPermissions: new Set<string>(), storePermissions: new Map([[fixture.demo.restaurantId, new Set(['orders.accept'])]]) };
    await err(createOrder('alrayez', input(), key(), new Date(), undefined, staffOptions(noVerify, true)), 'FORBIDDEN');
    await fixture.d.update(s.restaurants).set({ isActive: false }).where(eq(s.restaurants.id, fixture.demo.restaurantId));
    try { await err(createOrder('alrayez', input(), key(), new Date(), undefined, staffOptions(cashier)), 'STORE_CLOSED'); }
    finally { await fixture.d.update(s.restaurants).set({ isActive: true }).where(eq(s.restaurants.id, fixture.demo.restaurantId)); }
    await fixture.d.update(s.restaurants).set({ orderingStatus: 'PAUSED' }).where(eq(s.restaurants.id, fixture.demo.restaurantId));
    try { await err(createOrder('alrayez', input(), key(), new Date(), undefined, staffOptions(cashier)), 'STORE_PAUSED'); }
    finally { await fixture.d.update(s.restaurants).set({ orderingStatus: 'OPEN' }).where(eq(s.restaurants.id, fixture.demo.restaurantId)); }
  });
});
