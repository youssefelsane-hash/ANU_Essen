/**
 * The acceptance scenario from the spec, step by step, against the real services and a real
 * (in-memory) Postgres. UI-only steps (QR scan, countdown rendering, print dialog) are verified
 * manually in the browser; here we check the data each step depends on.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '@/server/db/schema';
import type { Db } from '@/server/db';
import { createOrder, quote } from '@/server/services/checkout';
import { applyOrderAction, type ActionActor } from '@/server/services/order-actions';
import { loadPublicMenu } from '@/server/services/menu';
import { loadTrackingView } from '@/server/services/order-views';
import { merchantSync } from '@/server/services/sync';
import { financeByRestaurant, periodStats } from '@/server/services/stats';
import { getActiveLoad, getQueueConfig } from '@/server/services/store';
import { receiptText } from '@/lib/receipt-text';
import { prepMinutesForLoad } from '@/lib/domain/queue';
import { authFor, setupTestDb } from './helpers/db';

let d: Db;
let restaurantId: string;

beforeAll(async () => {
  const setup = await setupTestDb();
  d = setup.d;
  restaurantId = setup.demo.restaurantId;
});

describe('acceptance scenario (spec §46)', () => {
  it('runs from QR scan to commission in the admin dashboard', async () => {
    const cashier = await authFor(d, 'cashier@alrayez.test');
    const kitchen = await authFor(d, 'kitchen@alrayez.test');
    const delivery = await authFor(d, 'delivery@alrayez.test');
    const owner = await authFor(d, 'owner@alrayez.test');
    const staff = (a: typeof owner, deviceId?: string): ActionActor => ({ type: 'USER', userId: a.user.id, label: a.user.name, auth: a, deviceId });
    const tablet = crypto.randomUUID();

    // 1–2. Student scans the QR → menu opens.
    const menu = (await loadPublicMenu(d, 'alrayez'))!;
    expect(menu.store.status).toBe('OPEN');
    const sandwich = menu.products.find((p) => p.nameEn === 'Chicken Shawarma Sandwich')!;
    const regular = sandwich.variants.find((v) => v.nameEn === 'Regular')!;

    // 3–4. Selects 3 sandwiches; the cart total is computed by the server.
    const items = [{ productId: sandwich.id, variantId: regular.id, addonIds: [], quantity: 3 }];
    const q = await quote('alrayez', { items });
    expect(q.total).toBe(3 * regular.price);

    // Device bootstraps before the order exists.
    const boot = await merchantSync({ auth: cashier, restaurantId, deviceId: tablet, cursor: 0 });

    // 5–7. InstaPay, created exactly once (double tap), order number returned.
    const input = { items, customerName: 'Ahmed', customerPhone: '01012345678', paymentMethod: 'INSTAPAY' as const, source: 'campus_poster_1' };
    const [a, b] = await Promise.all([createOrder('alrayez', input, 'accept-key-1'), createOrder('alrayez', input, 'accept-key-1')]);
    expect(a.orderId).toBe(b.orderId);
    expect(a.orderNumber).toMatch(/^[A-Z]\d{3}$/);
    expect(await d.select().from(s.orders).where(eq(s.orders.idempotencyKey, 'accept-key-1'))).toHaveLength(1);

    // 8–9. Restaurant terminal receives the order (and acknowledges it by its cursor).
    const sync1 = await merchantSync({ auth: cashier, restaurantId, deviceId: tablet, cursor: boot.cursor });
    expect(sync1.orders.map((o) => o.id)).toContain(a.orderId);

    // Student reports the transfer.
    await applyOrderAction({ orderId: a.orderId, action: 'SUBMIT_PAYMENT', actor: { type: 'CUSTOMER', label: 'customer' }, payload: { reference: 'IPN-1' } });

    // 10–12. Restaurant verifies payment → order enters the queue with an ETA from the current load.
    const { load } = await getActiveLoad(d, restaurantId);
    const cfg = await getQueueConfig(d, restaurantId);
    await applyOrderAction({ orderId: a.orderId, action: 'VERIFY_PAYMENT', actor: staff(cashier, tablet), clientEventId: crypto.randomUUID() });
    const [confirmed] = await d.select().from(s.orders).where(eq(s.orders.id, a.orderId));
    expect(confirmed.status).toBe('CONFIRMED');
    expect((confirmed.estimatedReadyAt!.getTime() - confirmed.confirmedAt!.getTime()) / 60_000).toBe(prepMinutesForLoad(load + 3, cfg));

    // 13. Customer sees a server-authoritative countdown target.
    const tracking1 = (await loadTrackingView(d, a.trackingToken))!;
    expect(tracking1.order.estimatedArrivalAt).toBe(confirmed.estimatedArrivalAt!.getTime());

    // 14. Kitchen marks preparing.
    await applyOrderAction({ orderId: a.orderId, action: 'START_PREPARING', actor: staff(kitchen, tablet), clientEventId: crypto.randomUUID() });

    // 15–17. Internet drops: READY and OUT_FOR_DELIVERY are recorded on the device with their real times.
    const readyAt = Date.now();
    await new Promise((r) => setTimeout(r, 20));
    const outAt = Date.now();
    const outbox = [
      { eventId: crypto.randomUUID(), action: 'MARK_READY' as const, occurredAt: readyAt, who: kitchen },
      { eventId: crypto.randomUUID(), action: 'OUT_FOR_DELIVERY' as const, occurredAt: outAt, who: delivery },
    ];
    // Meanwhile another student orders — the tablet can't see it yet.
    const missed = await createOrder('alrayez', { ...input, customerName: 'Mona', customerPhone: '01122334455', paymentMethod: 'CASH' }, 'accept-key-2');

    // 18–19. Internet returns: outbox flushes (twice, simulating a retry) and is applied exactly once.
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const e of outbox) {
        const r = await applyOrderAction({ orderId: a.orderId, action: e.action, actor: staff(e.who, tablet), clientEventId: e.eventId, occurredAt: new Date(e.occurredAt) });
        expect(r.result).toBe(attempt === 0 ? 'applied' : 'duplicate');
      }
    }
    const [out] = await d.select().from(s.orders).where(eq(s.orders.id, a.orderId));
    expect(out.status).toBe('OUT_FOR_DELIVERY');
    expect(out.readyAt!.getTime()).toBe(readyAt);
    expect(out.outForDeliveryAt!.getTime()).toBe(outAt);

    // ...and the pull sync brings the order created during the outage.
    const sync2 = await merchantSync({ auth: cashier, restaurantId, deviceId: tablet, cursor: sync1.cursor });
    expect(sync2.orders.map((o) => o.id)).toEqual(expect.arrayContaining([a.orderId, missed.orderId]));

    // 20. Customer tracking reflects the synced state.
    expect((await loadTrackingView(d, a.trackingToken))!.order.status).toBe('OUT_FOR_DELIVERY');

    // 21–22. Arrived at the gate, completed.
    await applyOrderAction({ orderId: a.orderId, action: 'MARK_ARRIVED', actor: staff(delivery) });
    await applyOrderAction({ orderId: a.orderId, action: 'COMPLETE', actor: staff(delivery) });

    // 23. Receipt can be produced from the stored snapshot.
    const [snap] = (await merchantSync({ auth: cashier, restaurantId, deviceId: tablet, cursor: 0 })).orders.filter((o) => o.id === a.orderId);
    const text = receiptText(snap, 'الرايظ الدمشقية', 'Africa/Cairo');
    expect(text).toContain(`Order #${a.orderNumber}`);
    expect(text).toContain('PAID');

    // 24. Sale appears in the merchant dashboard numbers.
    const dayStart = new Date(Date.now() - 3_600_000);
    const dayEnd = new Date(Date.now() + 3_600_000);
    const storeDay = await periodStats(d, dayStart, dayEnd, restaurantId);
    expect(storeDay.completed).toBe(1);
    expect(storeDay.sales).toBe(q.total);

    // 25. Platform commission appears for the super admin (5% snapshot).
    const finance = (await financeByRestaurant(d, dayStart, dayEnd)).find((f) => f.restaurantId === restaurantId)!;
    expect(finance.period.commission).toBe(Math.round(q.total * 0.05));
    expect(finance.allTime.outstanding).toBe(finance.allTime.commission);

    // 26. Audit logs show the important actions.
    const audits = await d.select({ action: s.auditLogs.action }).from(s.auditLogs).where(and(eq(s.auditLogs.entityId, a.orderId)));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(['order.submit_payment', 'order.verify_payment', 'order.complete']));
    expect(owner.storePermissions.get(restaurantId)?.has('reports.view')).toBe(true);
  });
});
