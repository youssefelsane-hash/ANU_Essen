import './load-env';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb } from '../src/server/db';
import * as s from '../src/server/db/schema';
import { assignRole, bootstrapRestaurant, ensureUser } from '../src/server/seed';
import { loadAuthz } from '../src/server/auth/authz';
import { applyOrderAction } from '../src/server/services/order-actions';
import { recordCourierHandIn, reverseCourierHandIn } from '../src/server/services/couriers';

const base = process.env.CAPACITY_BASE_URL || 'http://localhost:3107';
const local = (value: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
assert(local(base) && local(process.env.DATABASE_URL || ''), 'Courier verification requires a local app and database.');
assert.notEqual(process.env.NODE_ENV, 'production', 'Disposable fixtures must not run against production.');
const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice(9);
const stamp = `courier-check-${Date.now()}`;
const d = db();
const storeIds: string[] = [];
const userIds: string[] = [];
const report: Record<string, unknown> = { environment: 'local Next.js production build + PostgreSQL', startedAt: new Date().toISOString() };
async function session(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await d.insert(s.sessions).values({ id: createHash('sha256').update(token).digest('hex'), userId, expiresAt: new Date(Date.now() + 3_600_000) });
  return `sid=${token}`;
}
async function request(path: string, cookie: string, body?: unknown) {
  const response = await fetch(new URL(path, base), { method: body ? 'POST' : 'GET', headers: { cookie, origin: base, 'accept-language': 'en', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  return { status: response.status, data: await response.json() };
}
async function main() {
  try {
    const admin = await ensureUser(d, { email: `${stamp}-admin@local.test`, name: 'Courier verifier admin', password: randomBytes(24).toString('hex') });
    userIds.push(admin.id); await assignRole(d, admin.id, 'SUPER_ADMIN', null);
    const a = await ensureUser(d, { email: `${stamp}-a@local.test`, name: 'Shared courier A', password: randomBytes(24).toString('hex') });
    const b = await ensureUser(d, { email: `${stamp}-b@local.test`, name: 'Courier B', password: randomBytes(24).toString('hex') });
    userIds.push(a.id, b.id);
    const stores: { restaurant: typeof s.restaurants.$inferSelect; point: typeof s.deliveryPoints.$inferSelect; product: typeof s.products.$inferSelect }[] = [];
    for (let i = 0; i < 3; i++) {
      const restaurant = await bootstrapRestaurant(d, { slug: `${stamp}-${i}`, nameAr: `اختبار توصيل ${i}`, nameEn: `Courier test ${i}` });
      storeIds.push(restaurant.id);
      await d.update(s.restaurants).set({ requirePhone: false }).where(eq(s.restaurants.id, restaurant.id));
      const [point] = await d.insert(s.deliveryPoints).values({ restaurantId: restaurant.id, kind: 'DELIVERY', nameAr: 'الجمعية', nameEn: 'Association', isDefault: true }).returning();
      const [category] = await d.insert(s.categories).values({ restaurantId: restaurant.id, nameAr: 'تجربة', nameEn: 'Test' }).returning();
      const [product] = await d.insert(s.products).values({ restaurantId: restaurant.id, categoryId: category.id, nameAr: 'صنف', nameEn: 'Item', basePrice: 1000 * (i + 1) }).returning();
      stores.push({ restaurant, point, product });
    }
    await assignRole(d, a.id, 'DELIVERY_STAFF', storeIds[0]); await assignRole(d, a.id, 'DELIVERY_STAFF', storeIds[1]);
    await assignRole(d, b.id, 'DELIVERY_STAFF', storeIds[0]);
    const [cookieA, cookieB] = await Promise.all([session(a.id), session(b.id)]);
    const counterUser = await ensureUser(d, { email: `${stamp}-cashier@local.test`, name: 'Session switch cashier', password: randomBytes(24).toString('hex') });
    userIds.push(counterUser.id);
    await assignRole(d, counterUser.id, 'CASHIER', storeIds[0]);
    const [counterCookie, adminCookie] = await Promise.all([session(counterUser.id), session(admin.id)]);
    const adminAuth = await loadAuthz(d, admin);
    const actor = { auth: adminAuth };
    const orders: { id: string; restaurantId: string }[] = [];
    for (const index of [0, 1, 0]) {
      const store = stores[index];
      const response = await fetch(`${base}/api/public/stores/${store.restaurant.slug}/orders`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), 'x-forwarded-for': '198.18.44.22' }, body: JSON.stringify({ customerName: 'Disposable courier test', paymentMethod: 'CASH', deliveryPointId: store.point.id, items: [{ productId: store.product.id, quantity: 1, variantId: null, addonIds: [] }] }) });
      const created = await response.json(); assert.equal(response.status, 201, JSON.stringify(created));
      await applyOrderAction({ orderId: created.orderId, restaurantId: store.restaurant.id, action: 'MARK_READY', actor: { type: 'USER', userId: admin.id, label: admin.name, auth: adminAuth } });
      orders.push({ id: created.orderId, restaurantId: store.restaurant.id });
    }
    const viewer = (cookie: string) => cookie === cookieA ? a.id : b.id;
    const sync = (restaurantId: string, cookie: string, actorUserId = viewer(cookie)) => request(`/api/merchant/sync?restaurantId=${restaurantId}&deviceId=${randomUUID()}&cursor=0&actorUserId=${actorUserId}`, cookie);
    const summary = (restaurantId: string, cookie: string, actorUserId = viewer(cookie)) => request(`/api/merchant/delivery-summary?restaurantId=${restaurantId}&actorUserId=${actorUserId}`, cookie);
    const [one, two, forbidden] = await Promise.all([sync(storeIds[0], cookieA), sync(storeIds[1], cookieA), sync(storeIds[2], cookieA)]);
    assert.equal(one.status, 200); assert.equal(one.data.orders.length, 2);
    assert.equal(two.status, 200); assert.equal(two.data.orders.length, 1);
    assert.equal(one.data.viewerUserId, a.id); assert.equal(two.data.viewerUserId, a.id);
    assert.equal(forbidden.status, 403);
    const action = (order: typeof orders[number], name: string, cookie: string, actorUserId = viewer(cookie)) => request('/api/merchant/actions', cookie, { actorUserId, restaurantId: order.restaurantId, deviceId: randomUUID(), actions: [{ eventId: randomUUID(), orderId: order.id, action: name, occurredAt: Date.now() }] });
    // Both users may deliver for this store: these failures prove identity binding, not tenant denial.
    // A stale tab showing A's orders must never read B's cash or submit its outbox as B after a login switch.
    const beforeSwitch = await d.select().from(s.orders).where(eq(s.orders.id, orders[0].id));
    const beforeEvents = await d.select({ id: s.orderEvents.id }).from(s.orderEvents).where(eq(s.orderEvents.orderId, orders[0].id));
    const switched = await Promise.all([
      sync(storeIds[0], cookieB, a.id),
      action(orders[0], 'OUT_FOR_DELIVERY', cookieB, a.id),
      summary(storeIds[0], cookieB, a.id),
    ]);
    const missingActor = await Promise.all([
      request(`/api/merchant/sync?restaurantId=${storeIds[0]}&deviceId=${randomUUID()}&cursor=0`, cookieA),
      request('/api/merchant/actions', cookieA, { restaurantId: orders[0].restaurantId, deviceId: randomUUID(), actions: [{ eventId: randomUUID(), orderId: orders[0].id, action: 'OUT_FOR_DELIVERY', occurredAt: Date.now() }] }),
      request(`/api/merchant/delivery-summary?restaurantId=${storeIds[0]}`, cookieA),
    ]);
    for (const result of [...switched, ...missingActor]) {
      assert.equal(result.status, 401, JSON.stringify(result.data));
      assert.equal(result.data.error?.code, 'UNAUTHENTICATED');
    }
    assert.deepEqual(await d.select().from(s.orders).where(eq(s.orders.id, orders[0].id)), beforeSwitch, 'A switched or unbound actor must not mutate the order.');
    assert.deepEqual(await d.select({ id: s.orderEvents.id }).from(s.orderEvents).where(eq(s.orderEvents.orderId, orders[0].id)), beforeEvents, 'Denied stale-session actions must not append events.');
    const [counterPickup] = await d.select({ id: s.deliveryPoints.id }).from(s.deliveryPoints).where(and(eq(s.deliveryPoints.restaurantId, storeIds[0]), eq(s.deliveryPoints.kind, 'PICKUP')));
    const canonicalCounter = { restaurantId: storeIds[0], customerName: 'Persisted cashier request', paymentMethod: 'CASH', deliveryPointId: counterPickup.id, items: [{ productId: stores[0].product.id, quantity: 1, variantId: null, addonIds: [] }] };
    const counterKey = randomUUID();
    const counterRequest = async (quote: boolean, cookie: string, actorUserId?: string) => {
      const response = await fetch(`${base}/api/merchant/orders${quote ? '/quote' : ''}`, {
        method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json', 'idempotency-key': counterKey },
        body: JSON.stringify({ ...canonicalCounter, actorUserId }), signal: AbortSignal.timeout(20_000),
      });
      return { status: response.status, data: await response.json() };
    };
    const beforeCounterBinding = await d.select().from(s.orders).where(eq(s.orders.restaurantId, storeIds[0]));
    // Both the current cashier and stale administrator have orders.create here: identity alone denies it.
    const counterDenied = await Promise.all([
      counterRequest(false, counterCookie, admin.id), counterRequest(true, counterCookie, admin.id),
      counterRequest(false, counterCookie), counterRequest(true, counterCookie),
    ]);
    for (const result of counterDenied) {
      assert.equal(result.status, 401, JSON.stringify(result.data));
      assert.equal(result.data.error?.code, 'UNAUTHENTICATED');
    }
    assert.deepEqual(await d.select().from(s.orders).where(eq(s.orders.restaurantId, storeIds[0])), beforeCounterBinding, 'Counter session mismatches must not create or modify an order.');
    const counterQuote = await counterRequest(true, adminCookie, admin.id);
    assert.equal(counterQuote.status, 200); assert.equal(counterQuote.data.viewerUserId, admin.id); assert.equal(counterQuote.data.total, 1000);
    const counterCreated = await counterRequest(false, adminCookie, admin.id);
    assert.equal(counterCreated.status, 201); assert.equal(counterCreated.data.viewerUserId, admin.id);
    const counterReplay = await counterRequest(false, adminCookie, admin.id);
    assert.equal(counterReplay.status, 200); assert.equal(counterReplay.data.orderId, counterCreated.data.orderId); assert.equal(counterReplay.data.replayed, true);
    const [boundCounter] = await d.select().from(s.orders).where(eq(s.orders.id, counterCreated.data.orderId));
    assert.equal(boundCounter.createdByUserId, admin.id); assert.equal(boundCounter.platformFeeAmount, 0);
    for (const order of orders.slice(0, 2)) {
      const claimedResponse = await action(order, 'OUT_FOR_DELIVERY', cookieA);
      assert.equal(claimedResponse.data.viewerUserId, a.id);
      assert.equal(claimedResponse.data.results[0].result, 'applied');
      assert.equal((await action(order, 'COMPLETE', cookieA)).data.results[0].result, 'applied');
    }
    const racers = await Promise.all(Array.from({ length: 100 }, (_, i) => action(orders[2], 'OUT_FOR_DELIVERY', i % 2 ? cookieA : cookieB)));
    assert(racers.every((result) => result.status === 200));
    assert.equal(racers.filter((result) => result.data.results[0].result === 'applied').length, 1, 'One courier must win the claim race.');
    const [claimed] = await d.select().from(s.orders).where(eq(s.orders.id, orders[2].id));
    assert([a.id, b.id].includes(claimed.assignedToUserId!));
    const winnerCookie = claimed.assignedToUserId === a.id ? cookieA : cookieB;
    const loserCookie = claimed.assignedToUserId === a.id ? cookieB : cookieA;
    assert.equal((await action(orders[2], 'COMPLETE', loserCookie)).data.results[0].code, 'FORBIDDEN');
    assert.equal((await action(orders[2], 'COMPLETE', winnerCookie)).data.results[0].result, 'applied');
    const expectedOne = 1050 + (claimed.assignedToUserId === a.id ? 1050 : 0);
    const [reportOne, reportTwo, reportDenied] = await Promise.all([
      summary(storeIds[0], cookieA), summary(storeIds[1], cookieA), summary(storeIds[2], cookieA),
    ]);
    assert.equal(reportOne.status, 200); assert.equal(reportOne.data.cashOutstanding, expectedOne);
    assert.equal(reportTwo.status, 200); assert.equal(reportTwo.data.cashOutstanding, 2100);
    assert.equal(reportOne.data.viewerUserId, a.id); assert.equal(reportTwo.data.viewerUserId, a.id);
    assert.equal(reportDenied.status, 403);
    const key = randomUUID();
    const handIns = await Promise.all(Array.from({ length: 20 }, () => recordCourierHandIn({ restaurantId: storeIds[0], courierUserId: a.id, amount: 1000, idempotencyKey: key, actor })));
    assert.equal(handIns.filter((entry) => entry.result === 'applied').length, 1);
    assert.equal(new Set(handIns.map((entry) => entry.handInId)).size, 1);
    await assert.rejects(recordCourierHandIn({ restaurantId: storeIds[1], courierUserId: a.id, amount: 2101, idempotencyKey: randomUUID(), actor }));
    const after = await summary(storeIds[0], cookieA);
    assert.equal(after.data.cashOutstanding, expectedOne - 1000);
    const untouched = await summary(storeIds[1], cookieA);
    assert.equal(untouched.data.cashOutstanding, 2100, 'Receiving cash for one restaurant must not reduce another balance.');
    const reversalKey = randomUUID();
    const reversals = await Promise.all(Array.from({ length: 20 }, () => reverseCourierHandIn({ handInId: handIns[0].handInId, idempotencyKey: reversalKey, note: 'Disposable test correction', actor })));
    assert.equal(reversals.filter((entry) => entry.result === 'applied').length, 1);
    assert.equal((await summary(storeIds[0], cookieA)).data.cashOutstanding, expectedOne);
    report.passed = true;
    report.scope = { allowedRestaurants: 2, unassignedRestaurantDenied: true, otherCourierHandoverDenied: true,
      switchedSessionRequestsDenied: switched.length, missingActorRequestsDenied: missingActor.length, staleSessionMutations: 0, viewerIdentityStamped: true,
      counterIdentityRequestsDenied: counterDenied.length, boundCounterReplaysCreated: 1, counterCreatorVerified: true };
    report.claimRace = { simultaneousAttempts: 100, successfulClaims: 1 };
    report.accounting = { separateRestaurantBalances: true, handInAttempts: 20, recordedHandIns: 1, reversalAttempts: 20, recordedReversals: 1, overpaymentRejected: true, correctionRestoresExactBalance: true };
  } finally {
    if (storeIds.length) {
      await d.transaction(async (tx) => {
        await tx.delete(s.courierCashEntries).where(and(inArray(s.courierCashEntries.restaurantId, storeIds), eq(s.courierCashEntries.entryKind, 'REVERSAL')));
        await tx.delete(s.courierCashEntries).where(inArray(s.courierCashEntries.restaurantId, storeIds));
        await tx.delete(s.auditLogs).where(inArray(s.auditLogs.restaurantId, storeIds));
        await tx.delete(s.orders).where(inArray(s.orders.restaurantId, storeIds));
        await tx.delete(s.products).where(inArray(s.products.restaurantId, storeIds));
        await tx.delete(s.restaurants).where(inArray(s.restaurants.id, storeIds));
        if (userIds.length) await tx.delete(s.users).where(inArray(s.users.id, userIds));
        await tx.delete(s.rateLimits).where(inArray(s.rateLimits.key, ['order:ip:198.18.44.22', ...userIds.flatMap((id) => [`delivery-summary:${id}`, `counter:${id}`, `counter-quote:${id}`])]));
      });
      report.temporaryFixturesRemoved = true;
    }
    await closeDb();
    report.finishedAt = new Date().toISOString();
    if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Courier verification failed'); process.exitCode = 1; });
