import './load-env';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { closeDb, db } from '../src/server/db';
import * as s from '../src/server/db/schema';
import { assignRole, bootstrapRestaurant, ensureUser } from '../src/server/seed';
import { loadAuthz } from '../src/server/auth/authz';
import { createOrder } from '../src/server/services/checkout';
import { applyOrderAction, type ActionActor } from '../src/server/services/order-actions';
import { merchantSync } from '../src/server/services/sync';
import { prepMinutesForLoad, type QueueConfig } from '../src/lib/domain/queue';
import type { CreateOrderInput } from '../src/lib/validation';
import { AppError } from '../src/server/errors';

/** Real, multi-connection PostgreSQL verification; uses and removes only unique temporary fixtures. */
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Use an isolated local PostgreSQL database.');
  assert.notEqual(process.env.NODE_ENV, 'production', 'This verification must run outside production.');
  process.env.DB_POOL_MAX = '12';
  const d = db();
  const stamp = `pg-verify-${Date.now()}-${randomBytes(3).toString('hex')}`;
  let restaurantId: string | null = null;
  let userId: string | null = null;
  const started = Date.now();
  const results: Record<string, unknown> = {};

  try {
    const connections = await Promise.all(Array.from({ length: 12 }, () =>
      d.execute(sql`select pg_backend_pid() as pid, pg_sleep(0.05)`)));
    const pids = new Set(connections.flatMap((rows) => (rows as unknown as { pid: number }[]).map((row) => row.pid)));
    assert(pids.size >= 2, 'The verification must exercise concurrent backend connections.');
    results.backendConnections = pids.size;
    const config: QueueConfig = {
      basePrepMinutes: 1, deliveryMinutes: 2, capacityRules: [{ maxLoad: 0, prepMinutes: 1 }],
      overflowStepUnits: 1, overflowStepMinutes: 1, busyAtLoad: 0, heavyAtLoad: 0,
      maxAcceptedLoad: 0, maxActiveOrders: 0, autoPause: false,
    };
    const restaurant = await bootstrapRestaurant(d, { slug: stamp, nameAr: 'مطعم اختبار مؤقت', nameEn: 'Temporary PostgreSQL Verification' }, config);
    restaurantId = restaurant.id;
    const [initialCounter] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, restaurantId));
    await d.update(s.restaurants).set({ requirePhone: false }).where(eq(s.restaurants.id, restaurantId));
    await d.update(s.restaurantPaymentMethods).set({ isEnabled: true })
      .where(and(eq(s.restaurantPaymentMethods.restaurantId, restaurantId), eq(s.restaurantPaymentMethods.method, 'INSTAPAY')));
    await d.insert(s.deliveryPoints).values({ restaurantId, nameAr: 'نقطة اختبار', nameEn: 'Test Pickup', isDefault: true });
    const [category] = await d.insert(s.categories).values({ restaurantId, nameAr: 'اختبار', nameEn: 'Verification' }).returning();
    const [product] = await d.insert(s.products).values({ restaurantId, categoryId: category.id, nameAr: 'منتج اختبار', nameEn: 'Test Item', basePrice: 1000, prepLoadUnits: 1 }).returning();
    const user = await ensureUser(d, { email: `${stamp}@verification.local`, name: 'Temporary Verification User', password: randomBytes(24).toString('base64url') });
    userId = user.id;
    await assignRole(d, userId, 'MERCHANT_OWNER', restaurantId);
    const auth = await loadAuthz(d, { id: user.id, name: user.name, email: user.email });
    const actor: ActionActor = { type: 'USER', userId, label: user.name, auth };
    const input: CreateOrderInput = { items: [{ productId: product.id, variantId: null, addonIds: [], quantity: 1 }], customerName: 'اختبار تزامن', customerPhone: null, paymentMethod: 'INSTAPAY' };
    const newKey = () => `${stamp}-${randomUUID()}`;

    const firstKey = newKey();
    const repeated = await Promise.all(Array.from({ length: 24 }, () => createOrder(stamp, input, firstKey)));
    assert.equal(new Set(repeated.map((order) => order.orderId)).size, 1);
    assert.equal(repeated.filter((order) => !order.replayed).length, 1);
    results.sameKeyCheckout = { requests: 24, created: 1, replayed: 23 };

    const [promo] = await d.insert(s.promotions).values({ restaurantId, name: 'Final allowance', type: 'FIXED', value: 100, code: 'LAST', usageLimit: 1 }).returning();
    const promoKey = newKey();
    const promoted = await Promise.all(Array.from({ length: 24 }, () => createOrder(stamp, { ...input, promoCode: 'LAST' }, promoKey)));
    assert.equal(new Set(promoted.map((order) => order.orderId)).size, 1);
    assert.equal(promoted.filter((order) => !order.replayed).length, 1);
    const [usedPromo] = await d.select().from(s.promotions).where(eq(s.promotions.id, promo.id));
    assert.equal(usedPromo.usedCount, 1);
    results.finalPromoAllowance = { requests: 24, created: 1, usageCount: usedPromo.usedCount };

    const unique = await Promise.all(Array.from({ length: 18 }, () => createOrder(stamp, input, newKey())));
    const all = [repeated[0], promoted[0], ...unique];
    assert.equal(new Set(all.map((order) => order.orderNumber)).size, 20);
    const [createdCounter] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, restaurantId));
    assert.equal(createdCounter.orderSeq - initialCounter.orderSeq, 20);
    assert.equal(createdCounter.eventSeq, 20);

    const eventId = randomUUID();
    const actionRetries = await Promise.all(Array.from({ length: 12 }, () => applyOrderAction({ orderId: all[0].orderId, action: 'VERIFY_PAYMENT', actor, clientEventId: eventId })));
    assert.equal(actionRetries.filter((result) => result.result === 'applied').length, 1);
    assert.equal(actionRetries.filter((result) => result.result === 'duplicate').length, 11);
    results.sameActionReplay = { requests: 12, applied: 1, duplicate: 11 };

    await Promise.all(all.slice(1).map((order) => applyOrderAction({ orderId: order.orderId, action: 'VERIFY_PAYMENT', actor, clientEventId: randomUUID() })));
    const confirmationEvents = await d.select().from(s.orderEvents)
      .where(and(eq(s.orderEvents.restaurantId, restaurantId), eq(s.orderEvents.action, 'VERIFY_PAYMENT'))).orderBy(asc(s.orderEvents.seq));
    const orderRows = await d.select().from(s.orders).where(eq(s.orders.restaurantId, restaurantId));
    assert.equal(confirmationEvents.length, 20);
    for (const [index, event] of confirmationEvents.entries()) {
      const row = orderRows.find((order) => order.id === event.orderId)!;
      const eta = event.data!.eta as { projectedLoad: number };
      assert.equal(eta.projectedLoad, index + 1, `Confirmation cursor ${event.seq} must observe committed prior load.`);
      assert.equal((row.estimatedReadyAt!.getTime() - row.confirmedAt!.getTime()) / 60_000, prepMinutesForLoad(index + 1, config));
    }
    results.concurrentConfirmations = { confirmed: 20, projectedLoads: '1 through 20 in committed cursor order', preparationMinutes: '2 through 21' };
    await assert.rejects(applyOrderAction({ orderId: all[1].orderId, action: 'VERIFY_PAYMENT', actor, clientEventId: eventId }),
      (err: unknown) => err instanceof AppError && err.code === 'IDEMPOTENCY_MISMATCH');

    // Counter-first checkouts overlap with order-first actions, exercising the actual lock paths.
    const [mixedCreated] = await Promise.all([
      Promise.all(Array.from({ length: 8 }, () => createOrder(stamp, input, newKey()))),
      Promise.all(all.slice(0, 8).map((order) => applyOrderAction({ orderId: order.orderId, action: 'MARK_READY', actor, clientEventId: randomUUID() }))),
    ]);
    await Promise.all(mixedCreated.map((order) => applyOrderAction({ orderId: order.orderId, action: 'VERIFY_PAYMENT', actor, clientEventId: randomUUID() })));
    results.mixedCheckoutAndKitchen = { newOrders: 8, kitchenTransitions: 8, subsequentConfirmations: 8, errors: 0 };

    const deviceId = randomUUID();
    const bootstrap = await merchantSync({ auth, restaurantId, deviceId, cursor: 0 });
    let cursor = bootstrap.cursor;
    const seen = new Set<string>();
    const cursors = [cursor];
    let finished = false;
    const changes = Promise.all([
      Promise.all(Array.from({ length: 8 }, () => createOrder(stamp, input, newKey()))),
      Promise.all(all.slice(8, 16).map((order) => applyOrderAction({ orderId: order.orderId, action: 'START_PREPARING', actor, clientEventId: randomUUID() }))),
    ]).finally(() => { finished = true; });
    do {
      const sync = await merchantSync({ auth, restaurantId, deviceId, cursor });
      assert(sync.cursor >= cursor, 'Sync cursor must never move backwards.');
      cursor = sync.cursor;
      cursors.push(cursor);
      sync.orders.forEach((order) => seen.add(order.id));
    } while (!finished);
    const [newOrders] = await changes;
    const finalSync = await merchantSync({ auth, restaurantId, deviceId, cursor });
    assert(finalSync.cursor >= cursor);
    cursor = finalSync.cursor;
    cursors.push(cursor);
    finalSync.orders.forEach((order) => seen.add(order.id));
    for (const order of [...newOrders, ...all.slice(8, 16)]) assert(seen.has(order.orderId), 'No committed changed order may be skipped during pull sync.');

    const events = await d.select().from(s.orderEvents).where(eq(s.orderEvents.restaurantId, restaurantId)).orderBy(asc(s.orderEvents.seq));
    const [counter] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, restaurantId));
    assert.equal(events.length, counter.eventSeq);
    assert.deepEqual(events.map((event) => event.seq), Array.from({ length: events.length }, (_, index) => index + 1));
    assert.equal(cursor, counter.eventSeq);
    assert.equal(counter.orderSeq - initialCounter.orderSeq, 36);
    results.cursorCatchup = { changedOrdersSeen: 16, totalOrders: counter.orderSeq - initialCounter.orderSeq, gapFreeEvents: counter.eventSeq, pollCursors: cursors };
    results.elapsedMs = Date.now() - started;
    console.log(JSON.stringify({ passed: true, ...results }, null, 2));
  } finally {
    if (restaurantId) {
      const cleanupRestaurantId = restaurantId;
      await d.transaction(async (tx) => {
        await tx.delete(s.auditLogs).where(eq(s.auditLogs.restaurantId, cleanupRestaurantId));
        await tx.delete(s.orders).where(eq(s.orders.restaurantId, cleanupRestaurantId));
        await tx.delete(s.products).where(eq(s.products.restaurantId, cleanupRestaurantId));
        await tx.delete(s.restaurants).where(eq(s.restaurants.id, cleanupRestaurantId));
        if (userId) await tx.delete(s.users).where(eq(s.users.id, userId));
      });
      const [remaining] = await d.select({ id: s.restaurants.id }).from(s.restaurants).where(eq(s.restaurants.id, cleanupRestaurantId));
      assert.equal(remaining, undefined, 'Temporary restaurant cleanup must complete.');
      console.log('Temporary verification restaurant and user removed.');
    }
    await closeDb();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : 'PostgreSQL verification failed.');
  process.exitCode = 1;
});
