import './load-env';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, closeDb } from '../src/server/db';
import * as s from '../src/server/db/schema';
import { bootstrapRestaurant, ensureUser, assignRole } from '../src/server/seed';
import type { QueueConfig } from '../src/lib/domain/queue';
import { periodStats } from '../src/server/services/stats';

/** 100 concurrent real HTTP requests. Local disposable fixtures only; never production. */
const base = process.env.CAPACITY_BASE_URL || 'http://localhost:3107';
const local = (url: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
assert(local(base) && local(process.env.DATABASE_URL || ''), 'Capacity verification requires a local app and local database.');
assert.notEqual(process.env.NODE_ENV, 'production', 'Do not run fixture verification with NODE_ENV=production.');
const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice(9);
const stamp = `capacity-${Date.now()}-${randomBytes(3).toString('hex')}`;
const ip = `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
const d = db();
const results: Record<string, unknown> = { environment: 'local Next.js production build + PostgreSQL 17', simultaneousRequests: 100, sharedClientIp: true, startedAt: new Date().toISOString() };
let restaurantId: string | null = null;
let userId: string | null = null;
let cookie = '';
const testPhones: string[] = [];
const deviceId = randomUUID();

async function request(path: string, body?: unknown, key?: string, authenticated = false) {
  const start = performance.now();
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'accept-language': 'en-GB', 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}), ...(authenticated ? { cookie, origin: base } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  return { status: response.status, data, ms: Math.round((performance.now() - start) * 10) / 10 };
}
async function burst(name: string, fn: (index: number) => ReturnType<typeof request>, expectedStatus: number | number[] = 200) {
  const start = performance.now();
  const responses = await Promise.all(Array.from({ length: 100 }, (_, index) => fn(index)));
  const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const failures = responses.filter((r) => !allowed.includes(r.status));
  assert.equal(failures.length, 0, `${name}: ${failures.length} unexpected responses; first=${JSON.stringify(failures[0])}`);
  const times = responses.map((r) => r.ms).sort((a, b) => a - b);
  const wallMs = Math.round(performance.now() - start);
  results[name] = { requests: 100, errors: 0, wallMs, p50Ms: times[49], p95Ms: times[94], p99Ms: times[98], maxMs: times[99], requestsPerSecond: Math.round(100_000 / wallMs * 10) / 10 };
  console.log(`${name}: 100 passed; p95=${times[94]} ms; duration=${wallMs} ms`);
  return responses;
}
async function action(orderId: string, actionName: string, eventId = randomUUID()) {
  const r = await request('/api/merchant/actions', { restaurantId, deviceId, actions: [{ eventId, orderId, action: actionName, occurredAt: Date.now() }] }, undefined, true);
  assert.equal(r.status, 200);
  assert.equal(r.data.results[0].result, 'applied', JSON.stringify(r.data));
  return r;
}

async function main() {
  assert.equal((await request('/api/ready')).status, 200);
  try {
    const config: QueueConfig = { basePrepMinutes: 1, deliveryMinutes: 2, capacityRules: [{ maxLoad: 100, prepMinutes: 1 }], overflowStepUnits: 10, overflowStepMinutes: 1, busyAtLoad: 0, heavyAtLoad: 0, maxAcceptedLoad: 0, maxActiveOrders: 0, autoPause: false };
    const restaurant = await bootstrapRestaurant(d, { slug: stamp, nameAr: 'اختبار سعة مؤقت', nameEn: 'Temporary Capacity Check' }, config);
    restaurantId = restaurant.id;
    await d.update(s.restaurants).set({ requirePhone: false }).where(eq(s.restaurants.id, restaurantId));
    await d.insert(s.deliveryPoints).values({ restaurantId, nameAr: 'نقطة الاختبار', nameEn: 'Test pickup', isDefault: true });
    const [category] = await d.insert(s.categories).values({ restaurantId, nameAr: 'اختبار', nameEn: 'Test' }).returning();
    const [product] = await d.insert(s.products).values({ restaurantId, categoryId: category.id, nameAr: 'صنف اختبار', nameEn: 'Test item', basePrice: 1000, prepLoadUnits: 1 }).returning();
    const user = await ensureUser(d, { email: `${stamp}@capacity.local`, name: 'Capacity tester', password: randomBytes(24).toString('base64url') });
    userId = user.id;
    await assignRole(d, userId, 'MERCHANT_OWNER', restaurantId);
    const token = randomBytes(32).toString('base64url');
    await d.insert(s.sessions).values({ id: createHash('sha256').update(token).digest('hex'), userId, expiresAt: new Date(Date.now() + 3_600_000) });
    cookie = `sid=${token}`;
    const orderBody = (index: number) => ({ customerName: `Capacity customer ${index}`, paymentMethod: 'CASH', items: [{ productId: product.id, quantity: 1, addonIds: [], variantId: null }], source: stamp });
    const keys = Array.from({ length: 100 }, () => `${stamp}-${randomUUID()}`);
    const menuPath = `/api/public/stores/${stamp}`;
    for (let i = 0; i < 3; i++) assert.equal((await request(menuPath)).status, 200);
    await burst('menuReads', () => request(menuPath));
    await burst('quotes', (i) => request(`${menuPath}/quote`, orderBody(i)));
    const created = await burst('checkout', (i) => request(`${menuPath}/orders`, orderBody(i), keys[i]), 201);
    const ids = created.map((r) => r.data.orderId as string);
    assert.equal(new Set(ids).size, 100, 'Every distinct checkout must create exactly one distinct order.');
    assert.equal(new Set(created.map((r) => r.data.orderNumber)).size, 100, 'Order numbers must not collide.');
    const replayed = await burst('checkoutReplay', (i) => request(`${menuPath}/orders`, orderBody(i), keys[i]));
    replayed.forEach((r, i) => { assert.equal(r.data.orderId, ids[i]); assert.equal(r.data.replayed, true); });
    const initialOrders = await d.select().from(s.orders).where(eq(s.orders.restaurantId, restaurantId));
    assert.equal(initialOrders.length, 100);
    await d.update(s.products).set({ basePrice: 1500 }).where(eq(s.products.id, product.id));
    const changedQuote = await request(`${menuPath}/quote`, orderBody(0));
    assert.equal(changedQuote.data.total, 1500, 'Menu changes must affect new quotes.');
    assert(initialOrders.every((o) => o.total === 1000), 'Existing orders must retain frozen prices.');
    await d.update(s.products).set({ basePrice: 1000 }).where(eq(s.products.id, product.id));
    const invalid = await request(`${menuPath}/orders`, { ...orderBody(0), customerName: 'X' }, `${stamp}-invalid`);
    assert.equal(invalid.status, 400);
    assert(!/[\u0600-\u06ff]/.test(invalid.data.error.message), 'English customer errors must be English.');
    const mismatch = await request(`${menuPath}/orders`, orderBody(999), keys[0]);
    assert.equal(mismatch.status, 422);
    for (const phase of ['ACCEPT', 'START_PREPARING', 'MARK_READY', 'OUT_FOR_DELIVERY', 'MARK_ARRIVED', 'COMPLETE']) {
      await burst(`phase_${phase}`, (i) => action(ids[i], phase));
    }
    await burst('trackingReads', (i) => request(`/api/public/orders/${created[i].data.trackingToken}`));
    const all = await d.select().from(s.orders).where(eq(s.orders.restaurantId, restaurantId));
    assert(all.every((o) => o.status === 'COMPLETED' && o.paymentStatus === 'PAYMENT_VERIFIED'));
    const events = await d.select().from(s.orderEvents).where(eq(s.orderEvents.restaurantId, restaurantId)).orderBy(asc(s.orderEvents.seq));
    assert.equal(events.length, 700);
    assert.deepEqual(events.map((event) => event.seq), Array.from({ length: 700 }, (_, i) => i + 1));
    const sync = await request(`/api/merchant/sync?restaurantId=${restaurantId}&deviceId=${deviceId}&cursor=0`, undefined, undefined, true);
    assert.equal(sync.status, 200); assert.equal(sync.data.cursor, 700); assert.equal(sync.data.orders.length, 100);
    const stats = await periodStats(d, new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000), restaurantId);
    assert.equal(stats.completed, 100); assert.equal(stats.sales, 100_000); assert.equal(stats.commission, 5000); assert.equal(stats.merchantNet, 95_000);
    results.integrity = { distinctOrders: 100, replayDuplicates: 0, completedOrders: 100, gapFreeEvents: 700, syncedOrders: 100, salesEGP: 1000, commissionEGP: 50, restaurantNetEGP: 950, priceSnapshotsPreserved: true };

    // Kitchen capacity is independent of request throughput: filled kitchens reject new orders.
    await d.update(s.queueConfigs).set({ config: { ...config, maxAcceptedLoad: 5, autoPause: true } }).where(eq(s.queueConfigs.restaurantId, restaurantId));
    const capacityOrders = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(`${menuPath}/orders`, orderBody(200 + i), `${stamp}-cap-${i}`);
      assert.equal(r.status, 201); capacityOrders.push(r.data.orderId as string);
      await action(r.data.orderId, 'ACCEPT');
    }
    await burst('fullKitchenRejection', (i) => request(`${menuPath}/orders`, orderBody(300 + i), `${stamp}-full-${i}`), 409);
    const beforeRelease = await d.select().from(s.orders).where(eq(s.orders.restaurantId, restaurantId));
    assert.equal(beforeRelease.length, 105, 'Rejected checkouts must not consume order numbers or create partial rows.');
    await action(capacityOrders[0], 'MARK_READY');
    const reopened = await request(`${menuPath}/orders`, orderBody(500), `${stamp}-reopened`);
    assert.equal(reopened.status, 201, 'Capacity must free up after a kitchen order is ready.');
    results.kitchenCapacity = { limit: 5, confirmed: 5, rejectedWhileFull: 100, resumedAfterReady: true };

    // Identity/permission and invalid-transition guards remain active through the HTTP layer.
    const unauthenticated = await request(`/api/merchant/sync?restaurantId=${restaurantId}&deviceId=${deviceId}&cursor=0`);
    assert.equal(unauthenticated.status, 401);
    const forbidden = await request(`/api/merchant/sync?restaurantId=${randomUUID()}&deviceId=${deviceId}&cursor=0`, undefined, undefined, true);
    assert.equal(forbidden.status, 403);
    const staleAction = await request('/api/merchant/actions', { restaurantId, deviceId, actions: [{ eventId: randomUUID(), orderId: ids[0], action: 'ACCEPT', occurredAt: Date.now() }] }, undefined, true);
    assert.equal(staleAction.data.results[0].result, 'rejected');
    results.guards = { signInRequired: true, crossRestaurantDenied: true, invalidTransitionRejected: true, idempotencyMismatchRejected: true, englishErrors: true };

    await d.update(s.queueConfigs).set({ config }).where(eq(s.queueConfigs.restaurantId, restaurantId));
    const testPhone = '015' + String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0');
    testPhones.push(testPhone);
    const phoneResponses = await Promise.all(Array.from({ length: 9 }, (_, i) => request(`${menuPath}/orders`, { ...orderBody(600 + i), customerPhone: testPhone }, `${stamp}-phone-${i}`)));
    assert.equal(phoneResponses.filter((r) => r.status === 201).length, 8);
    assert.equal(phoneResponses.filter((r) => r.status === 429).length, 1);
    const committedIndex = phoneResponses.findIndex((r) => r.status === 201);
    const phoneReplays = await burst('phoneReplayAfterLimit', () => request(`${menuPath}/orders`, { ...orderBody(600 + committedIndex), customerPhone: testPhone }, `${stamp}-phone-${committedIndex}`));
    phoneReplays.forEach((r) => {
      assert.equal(r.data.orderId, phoneResponses[committedIndex].data.orderId);
      assert.equal(r.data.trackingToken, phoneResponses[committedIndex].data.trackingToken);
      assert.equal(r.data.replayed, true);
    });
    const retryPhone = '010' + String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0');
    testPhones.push(retryPhone);
    const simultaneousRetry = await burst('concurrentSameKey', () => request(`${menuPath}/orders`, { ...orderBody(700), customerPhone: retryPhone }, `${stamp}-same-key`), [200, 201]);
    assert.equal(simultaneousRetry.filter((r) => r.status === 201).length, 1);
    assert.equal(new Set(simultaneousRetry.map((r) => r.data.orderId)).size, 1);
    const [phoneCounter] = await d.select().from(s.rateLimits).where(eq(s.rateLimits.key, `order:phone:${retryPhone}`));
    assert.equal(phoneCounter.count, 1, 'Concurrent retries must consume one phone allowance.');
    results.phoneProtection = { attemptedDistinct: 9, admitted: 8, rateLimited: 1, successfulReplaysAfterLimit: 100, simultaneousSameKeyAttempts: 100, simultaneousSameKeyCreated: 1, phoneAllowanceConsumed: 1 };
    results.passed = true;
  } finally {
    if (restaurantId) {
      await d.transaction(async (tx) => {
        await tx.delete(s.auditLogs).where(eq(s.auditLogs.restaurantId, restaurantId!));
        await tx.delete(s.orders).where(eq(s.orders.restaurantId, restaurantId!));
        await tx.delete(s.products).where(eq(s.products.restaurantId, restaurantId!));
        await tx.delete(s.restaurants).where(eq(s.restaurants.id, restaurantId!));
        if (userId) await tx.delete(s.users).where(eq(s.users.id, userId));
        if (testPhones.length) await tx.delete(s.customers).where(inArray(s.customers.phone, testPhones));
        await tx.delete(s.rateLimits).where(inArray(s.rateLimits.key, [`order:ip:${ip}`, `quote:${ip}`, ...testPhones.map((phone) => `order:phone:${phone}`)]));
      });
      assert.equal((await d.select().from(s.restaurants).where(eq(s.restaurants.id, restaurantId))).length, 0);
      results.temporaryFixturesRemoved = true;
    }
    await closeDb();
    results.finishedAt = new Date().toISOString();
    if (reportPath) await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n');
  }
  console.log(JSON.stringify(results, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Capacity verification failed.'); process.exitCode = 1; });
