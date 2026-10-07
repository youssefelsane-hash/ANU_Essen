/**
 * Pickup at the restaurant + walk-in (counter) orders entered by staff.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '@/server/db/schema';
import type { Db } from '@/server/db';
import type { AuthContext } from '@/server/auth/authz';
import { AppError } from '@/server/errors';
import { createCounterOrder, createOrder, quote } from '@/server/services/checkout';
import { applyOrderAction, type ActionActor } from '@/server/services/order-actions';
import { merchantSync } from '@/server/services/sync';
import { assignRole, bootstrapRestaurant, ensureUser, type DemoSeedResult } from '@/server/seed';
import { nextStatus, primaryActionFor } from '@/lib/domain/order-machine';
import type { CreateOrderInput } from '@/lib/validation';
import { authFor, setupTestDb, TEST_PASSWORD } from './helpers/db';

let d: Db;
let demo: DemoSeedResult;
let pickupId: string;
let gateId: string;
let cashier: AuthContext, kitchen: AuthContext, delivery: AuthContext;
let n = 0;
const key = () => `pc-${++n}-${Math.random().toString(36).slice(2)}`;
const staff = (a: AuthContext): ActionActor => ({ type: 'USER', userId: a.user.id, label: a.user.name, auth: a });
const asStaff = (a: AuthContext) => ({ userId: a.user.id, name: a.user.name, auth: a });
const items = () => [{ productId: demo.productIds['Chicken Shawarma Sandwich'], variantId: demo.variantIds['Chicken Shawarma Sandwich:Regular'], addonIds: [], quantity: 2 }];
const online = (over: Partial<CreateOrderInput> = {}): CreateOrderInput => ({ items: items(), customerName: 'Omar', customerPhone: '01011112222', paymentMethod: 'CASH', ...over });
const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);

beforeAll(async () => {
  ({ d, demo } = await setupTestDb());
  const points = await d.select().from(s.deliveryPoints).where(eq(s.deliveryPoints.restaurantId, demo.restaurantId));
  pickupId = points.find((p) => p.kind === 'PICKUP')!.id;
  gateId = points.find((p) => p.isDefault)!.id;
  cashier = await authFor(d, 'cashier@alrayez.test');
  kitchen = await authFor(d, 'kitchen@alrayez.test');
  delivery = await authFor(d, 'delivery@alrayez.test');
});

describe('state machine for pickup orders', () => {
  it('skips the delivery leg', () => {
    expect(nextStatus('READY', 'COMPLETE', 'PICKUP')).toBe('COMPLETED');
    expect(nextStatus('READY', 'OUT_FOR_DELIVERY', 'PICKUP')).toBeNull();
    expect(nextStatus('READY', 'COMPLETE', 'DELIVERY')).toBeNull();
    expect(primaryActionFor('READY', 'PICKUP')).toBe('COMPLETE');
    expect(primaryActionFor('READY', 'DELIVERY')).toBe('OUT_FOR_DELIVERY');
  });
});

describe('pickup at the restaurant', () => {
  it('is offered by default next to the university gate, with no delivery time or fee', async () => {
    const atGate = await quote('alrayez', { items: items(), deliveryPointId: gateId });
    const atShop = await quote('alrayez', { items: items(), deliveryPointId: pickupId });
    expect(atShop.etaMinutes).toBeLessThan(atGate.etaMinutes);
    expect(atShop.deliveryFee).toBe(0);
    // Default stays the university gate.
    expect((await createOrder('alrayez', online(), key())).status).toBe('CREATED');
  });

  it('goes ready → handed over at the counter, never out for delivery', async () => {
    const o = await createOrder('alrayez', online({ deliveryPointId: pickupId }), key());
    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(row.fulfillment).toBe('PICKUP');
    expect(row.deliveryFee).toBe(0);

    await applyOrderAction({ orderId: o.orderId, action: 'ACCEPT', actor: staff(cashier) });
    const [confirmed] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(confirmed.estimatedArrivalAt!.getTime()).toBe(confirmed.estimatedReadyAt!.getTime());

    await applyOrderAction({ orderId: o.orderId, action: 'MARK_READY', actor: staff(kitchen) });
    await expectCode(applyOrderAction({ orderId: o.orderId, action: 'OUT_FOR_DELIVERY', actor: staff(delivery) }), 'INVALID_TRANSITION');

    // Couriers don't see pickup orders.
    const courierView = await merchantSync({ auth: delivery, restaurantId: demo.restaurantId, deviceId: crypto.randomUUID(), cursor: 0 });
    expect(courierView.orders.some((x) => x.id === o.orderId)).toBe(false);

    await applyOrderAction({ orderId: o.orderId, action: 'COMPLETE', actor: staff(cashier) });
    const [done] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(done.status).toBe('COMPLETED');
    expect(done.paymentStatus).toBe('PAYMENT_VERIFIED');
  });

  it('a delivery order cannot be "handed over" straight from ready', async () => {
    const o = await createOrder('alrayez', online({ deliveryPointId: gateId }), key());
    await applyOrderAction({ orderId: o.orderId, action: 'ACCEPT', actor: staff(cashier) });
    await applyOrderAction({ orderId: o.orderId, action: 'MARK_READY', actor: staff(kitchen) });
    await expectCode(applyOrderAction({ orderId: o.orderId, action: 'COMPLETE', actor: staff(cashier) }), 'INVALID_TRANSITION');
  });
});

describe('counter (walk-in) orders', () => {
  it('goes straight to the kitchen queue, without name/phone, even while online ordering is paused', async () => {
    await d.update(s.restaurants).set({ orderingStatus: 'PAUSED', requirePhone: true }).where(eq(s.restaurants.id, demo.restaurantId));
    const o = await createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'CASH', deliveryPointId: pickupId }, key(), asStaff(cashier));
    await d.update(s.restaurants).set({ orderingStatus: 'OPEN' }).where(eq(s.restaurants.id, demo.restaurantId));
    expect(o.status).toBe('CONFIRMED');
    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(row).toMatchObject({ channel: 'COUNTER', fulfillment: 'PICKUP', createdByUserId: cashier.user.id, customerName: 'عميل المحل', customerPhone: null, source: 'counter' });
    expect(row.estimatedReadyAt).not.toBeNull();
    const [created] = await d.select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, o.orderId), eq(s.orderEvents.type, 'ORDER_CREATED')));
    expect(created).toMatchObject({ actorType: 'USER', actorUserId: cashier.user.id });
  });

  it('records one order per tap even if the button is pressed twice', async () => {
    const k = key();
    const [a, b] = await Promise.all([
      createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'CASH' }, k, asStaff(cashier)),
      createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'CASH' }, k, asStaff(cashier)),
    ]);
    expect(a.orderId).toBe(b.orderId);
    expect(await d.select().from(s.orders).where(eq(s.orders.idempotencyKey, k))).toHaveLength(1);
  });

  it('InstaPay at the counter is marked paid; cash works even if disabled for online orders', async () => {
    const paid = await createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'INSTAPAY' }, key(), asStaff(cashier));
    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, paid.orderId));
    expect(row).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAYMENT_VERIFIED' });

    await d.update(s.restaurantPaymentMethods).set({ isEnabled: false })
      .where(and(eq(s.restaurantPaymentMethods.restaurantId, demo.restaurantId), eq(s.restaurantPaymentMethods.method, 'CASH')));
    expect((await createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'CASH' }, key(), asStaff(cashier))).status).toBe('CONFIRMED');
    await d.update(s.restaurantPaymentMethods).set({ isEnabled: true })
      .where(and(eq(s.restaurantPaymentMethods.restaurantId, demo.restaurantId), eq(s.restaurantPaymentMethods.method, 'CASH')));
  });

  it('respects the counter commission setting', async () => {
    const charged = await createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'CASH' }, key(), asStaff(cashier));
    await d.update(s.restaurants).set({ counterCommissionEnabled: false }).where(eq(s.restaurants.id, demo.restaurantId));
    const waived = await createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'CASH' }, key(), asStaff(cashier));
    await d.update(s.restaurants).set({ counterCommissionEnabled: true }).where(eq(s.restaurants.id, demo.restaurantId));
    const [c] = await d.select().from(s.orders).where(eq(s.orders.id, charged.orderId));
    const [w] = await d.select().from(s.orders).where(eq(s.orders.id, waived.orderId));
    expect(c.commissionAmount).toBeGreaterThan(0);
    expect(w).toMatchObject({ commissionBps: 0, commissionAmount: 0, merchantNet: w.total });
  });

  it('is refused for staff without the permission, for other restaurants, and while the platform suspends the restaurant', async () => {
    await expectCode(createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'CASH' }, key(), asStaff(kitchen)), 'FORBIDDEN');

    const other = await bootstrapRestaurant(d, { slug: 'pc-other', nameAr: 'مطعم تاني', nameEn: 'Other' });
    const u = await ensureUser(d, { email: 'pc-owner2@test.local', name: 'Owner 2', password: TEST_PASSWORD });
    await assignRole(d, u.id, 'MERCHANT_OWNER', other.id);
    const owner2 = await authFor(d, 'pc-owner2@test.local');
    await expectCode(createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'CASH' }, key(), asStaff(owner2)), 'FORBIDDEN');
    // ...and can't use another restaurant's products or pickup points in their own store.
    await expect(createCounterOrder(other.id, { items: items(), paymentMethod: 'CASH' }, key(), asStaff(owner2))).rejects.toBeTruthy();
    await expectCode(createCounterOrder(other.id, { items: [], paymentMethod: 'CASH', deliveryPointId: pickupId }, key(), asStaff(owner2)), 'VALIDATION');

    await d.update(s.restaurants).set({ isActive: false }).where(eq(s.restaurants.id, demo.restaurantId));
    await expectCode(createCounterOrder(demo.restaurantId, { items: items(), paymentMethod: 'CASH' }, key(), asStaff(cashier)), 'STORE_CLOSED');
    await d.update(s.restaurants).set({ isActive: true }).where(eq(s.restaurants.id, demo.restaurantId));
  });
});
