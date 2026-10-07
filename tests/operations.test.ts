/**
 * Platform operations: suspending a restaurant, delivery hand-over accounting, offline courier assignment.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '@/server/db/schema';
import type { Db } from '@/server/db';
import { AppError } from '@/server/errors';
import { createOrder, quote } from '@/server/services/checkout';
import { applyOrderAction, type ActionActor } from '@/server/services/order-actions';
import { loadPublicMenu } from '@/server/services/menu';
import { courierSummary } from '@/server/services/stats';
import { applyPending } from '@/client/merchant/engine';
import { lastOrderFor, MY_ORDERS_KEY } from '@/client/storage';
import type { CreateOrderInput } from '@/lib/validation';
import type { DemoSeedResult } from '@/server/seed';
import type { OrderSnapshot } from '@/lib/types';
import { authFor, setupTestDb } from './helpers/db';

let d: Db;
let demo: DemoSeedResult;
let n = 0;
const key = () => `ops-${++n}-${Math.random().toString(36).slice(2)}`;

function input(over: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    items: [{ productId: demo.productIds['Chicken Shawarma Sandwich'], variantId: demo.variantIds['Chicken Shawarma Sandwich:Regular'], addonIds: [], quantity: 2 }],
    customerName: 'Sara',
    customerPhone: '01234567890',
    paymentMethod: 'CASH',
    ...over,
  };
}

beforeAll(async () => {
  ({ d, demo } = await setupTestDb());
});

describe('restaurant suspension', () => {
  it('blocks new orders and quotes with a clear message, keeps the menu reachable, and lets in-progress orders finish', async () => {
    const cashier = await authFor(d, 'cashier@alrayez.test');
    const staff: ActionActor = { type: 'USER', userId: cashier.user.id, label: 'cashier', auth: cashier };
    const inProgress = await createOrder('alrayez', input(), key());
    await applyOrderAction({ orderId: inProgress.orderId, action: 'ACCEPT', actor: staff });

    await d.update(s.restaurants).set({ isActive: false, suspendedReason: 'commission overdue' }).where(eq(s.restaurants.id, demo.restaurantId));

    const menu = await loadPublicMenu(d, 'alrayez');
    expect(menu?.store.reason).toBe('INACTIVE');
    await expect(createOrder('alrayez', input(), key())).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'STORE_CLOSED' && /متوقف/.test(e.message));
    await expect(quote('alrayez', { items: input().items })).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'STORE_CLOSED');

    // The order that was already accepted can still be completed.
    const kitchen = await authFor(d, 'kitchen@alrayez.test');
    await applyOrderAction({ orderId: inProgress.orderId, action: 'MARK_READY', actor: { type: 'USER', userId: kitchen.user.id, label: 'k', auth: kitchen } });

    await d.update(s.restaurants).set({ isActive: true, suspendedReason: null }).where(eq(s.restaurants.id, demo.restaurantId));
    expect((await createOrder('alrayez', input(), key())).status).toBe('CREATED');
  });
});

describe('delivery hand-over', () => {
  it('tracks deliveries and cash per courier for the end-of-shift hand-in', async () => {
    const cashier = await authFor(d, 'cashier@alrayez.test');
    const delivery = await authFor(d, 'delivery@alrayez.test');
    const asCashier: ActionActor = { type: 'USER', userId: cashier.user.id, label: 'c', auth: cashier };
    const asCourier: ActionActor = { type: 'USER', userId: delivery.user.id, label: 'd', auth: delivery };
    const kitchen = await authFor(d, 'kitchen@alrayez.test');
    const asKitchen: ActionActor = { type: 'USER', userId: kitchen.user.id, label: 'k', auth: kitchen };

    const cash = await createOrder('alrayez', input(), key());
    const cash2 = await createOrder('alrayez', input({ customerPhone: '01098765432' }), key());
    for (const o of [cash, cash2]) {
      await applyOrderAction({ orderId: o.orderId, action: 'ACCEPT', actor: asCashier });
      await applyOrderAction({ orderId: o.orderId, action: 'MARK_READY', actor: asKitchen });
      await applyOrderAction({ orderId: o.orderId, action: 'OUT_FOR_DELIVERY', actor: asCourier });
    }
    await applyOrderAction({ orderId: cash.orderId, action: 'MARK_ARRIVED', actor: asCourier });
    await applyOrderAction({ orderId: cash.orderId, action: 'COMPLETE', actor: asCourier });

    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);
    const summary = (await courierSummary(d, demo.restaurantId, from, to)).find((c) => c.userId === delivery.user.id)!;
    expect(summary.delivered).toBe(1);
    expect(summary.cashCollected).toBe(cash.total);
    expect(summary.onTheWay).toBe(1);
    expect(summary.cashPending).toBe(cash2.total);

    const [done] = await d.select().from(s.orders).where(eq(s.orders.id, cash.orderId));
    expect(done.paymentStatus).toBe('PAYMENT_VERIFIED'); // cash collected at hand-over
  });

  it('assigns the courier locally when an offline "out for delivery" is pending', () => {
    const order = { id: 'o1', status: 'READY', paymentMethod: 'CASH', paymentStatus: 'CASH', assignedToUserId: null } as unknown as OrderSnapshot;
    const view = applyPending(order, [{ eventId: 'e', orderId: 'o1', action: 'OUT_FOR_DELIVERY', occurredAt: 1, createdAt: 1, attempts: 0 }], 'courier-1');
    expect(view.status).toBe('OUT_FOR_DELIVERY');
    expect(view.assignedToUserId).toBe('courier-1');
  });
});

describe('returning customer', () => {
  it('finds the order to repeat (a specific one, or the latest with items)', () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
    const line = { productId: 'p', variantId: null, addonIds: [], quantity: 3 };
    store.set(MY_ORDERS_KEY, JSON.stringify([
      { token: 'new-no-lines', orderNumber: 'A3', slug: 'x', createdAt: 3 },
      { token: 'b', orderNumber: 'A2', slug: 'x', createdAt: 2, lines: [line] },
      { token: 'a', orderNumber: 'A1', slug: 'x', createdAt: 1, lines: [{ ...line, quantity: 1 }] },
      { token: 'other', orderNumber: 'B1', slug: 'y', createdAt: 4, lines: [line] },
    ]));
    expect(lastOrderFor('x')?.orderNumber).toBe('A2');
    expect(lastOrderFor('x', 'a')?.orderNumber).toBe('A1');
    expect(lastOrderFor('x', 'missing')?.orderNumber).toBe('A2');
    expect(lastOrderFor('z')).toBeNull();
  });
});
