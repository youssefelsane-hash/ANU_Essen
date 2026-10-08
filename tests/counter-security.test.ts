import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { POST as counterPost } from '@/app/api/merchant/orders/route';
import { POST as guestPost } from '@/app/api/public/stores/[slug]/orders/route';
import type { Db } from '@/server/db';
import * as s from '@/server/db/schema';
import { assignRole, bootstrapRestaurant, ensureUser, type DemoSeedResult } from '@/server/seed';
import { setupTestDb, TEST_PASSWORD } from './helpers/db';

// Only the Next request cookie store is replaced. Session expiry, blocked users and RBAC
// still run through the real database-backed authentication implementation.
const cookieState = vi.hoisted(() => ({ token: '' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => name === 'sid' && cookieState.token ? { name, value: cookieState.token } : undefined,
    set: () => {},
    delete: () => { cookieState.token = ''; },
  }),
}));

let d: Db, client: PGlite, demo: DemoSeedResult;
let ownerId: string, kitchenId: string, secondCashierId: string, restrictedId: string, otherRestaurantId: string, pickupPointId: string;
const tokens = new Map<string, string>();
const requestKey = () => `counter-security-${crypto.randomUUID()}`;

async function session(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await d.insert(s.sessions).values({
    id: createHash('sha256').update(token).digest('hex'), userId,
    expiresAt: new Date(Date.now() + 86_400_000), lastSeenAt: new Date(),
  });
  tokens.set(userId, token);
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    restaurantId: demo.restaurantId, customerName: 'Counter customer', customerPhone: '01050000999',
    paymentMethod: 'CASH', cashReceived: false,
    items: [{ productId: demo.productIds['Chicken Shawarma Sandwich'], variantId: demo.variantIds['Chicken Shawarma Sandwich:Regular'], quantity: 1, addonIds: [] }],
    ...overrides,
  };
}

async function counter(input: Record<string, unknown>, key = requestKey(), origin: string | null = 'http://localhost', headers: Record<string, string> = {}) {
  const res = await counterPost(new Request('http://localhost/api/merchant/orders', {
    method: 'POST',
    headers: { host: 'localhost', 'content-type': 'application/json', 'idempotency-key': key, 'x-forwarded-for': '198.51.100.81', 'accept-language': 'en', ...(origin === null ? {} : { origin }), ...headers },
    body: JSON.stringify(input),
  }), undefined);
  return { status: res.status, data: await res.json(), headers: res.headers };
}

async function row(id: string) {
  const [order] = await d.select().from(s.orders).where(eq(s.orders.id, id));
  return order;
}

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost/test');
  vi.stubEnv('LOG_LEVEL', 'error');
  ({ d, client, demo } = await setupTestDb());
  const users = await d.select().from(s.users);
  ownerId = users.find((user) => user.email === 'owner@alrayez.test')!.id;
  kitchenId = users.find((user) => user.email === 'kitchen@alrayez.test')!.id;
  const cashier = await ensureUser(d, { email: 'second-cashier@security.test', name: 'Second cashier', password: TEST_PASSWORD });
  secondCashierId = cashier.id;
  await assignRole(d, secondCashierId, 'CASHIER', demo.restaurantId);
  const restricted = await ensureUser(d, { email: 'restricted@security.test', name: 'Restricted operator', password: TEST_PASSWORD });
  restrictedId = restricted.id;
  const [role] = await d.insert(s.roles).values({ key: 'COUNTER_WITHOUT_PAYMENT', name: 'Counter without payment verification', scope: 'STORE' }).returning();
  await d.insert(s.rolePermissions).values({ roleId: role.id, permissionKey: 'orders.accept' });
  await d.insert(s.userRoles).values({ userId: restrictedId, roleId: role.id, restaurantId: demo.restaurantId });
  const other = await bootstrapRestaurant(d, { slug: 'security-other', nameAr: 'مطعم آخر', nameEn: 'Another restaurant' }, undefined, { defaultPoints: true });
  otherRestaurantId = other.id;
  const [pickup] = await d.select().from(s.deliveryPoints).where(and(eq(s.deliveryPoints.restaurantId, demo.restaurantId), eq(s.deliveryPoints.fulfillmentType, 'PICKUP')));
  pickupPointId = pickup.id;
  for (const userId of [ownerId, kitchenId, secondCashierId, restrictedId]) await session(userId);
});

beforeEach(() => { cookieState.token = tokens.get(ownerId)!; });
afterAll(async () => { await client.close(); vi.unstubAllEnvs(); });

describe('counter checkout authentication, pricing and idempotency security', () => {
  it('requires a valid session and never returns an order or tracking token to guests', async () => {
    cookieState.token = '';
    const response = await counter(body());
    expect(response.status).toBe(401);
    expect(response.data.error.code).toBe('UNAUTHENTICATED');
    expect(response.data.trackingToken).toBeUndefined();
  });

  it('rejects expired sessions and blocked users, including retries of a previous valid checkout', async () => {
    const key = requestKey();
    const original = await counter(body(), key);
    expect(original.status).toBe(201);
    await d.update(s.users).set({ isActive: false }).where(eq(s.users.id, ownerId));
    try {
      const blocked = await counter(body(), key);
      expect(blocked.status).toBe(401);
      expect(blocked.data.trackingToken).toBeUndefined();
    } finally {
      await d.update(s.users).set({ isActive: true }).where(eq(s.users.id, ownerId));
    }
    const hash = createHash('sha256').update(tokens.get(ownerId)!).digest('hex');
    await d.update(s.sessions).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(s.sessions.id, hash));
    try {
      expect((await counter(body(), key)).status).toBe(401);
    } finally {
      await d.update(s.sessions).set({ expiresAt: new Date(Date.now() + 86_400_000) }).where(eq(s.sessions.id, hash));
    }
  });

  it('requires orders.accept in the requested restaurant and rejects a kitchen-only operator', async () => {
    cookieState.token = tokens.get(kitchenId)!;
    const kitchen = await counter(body());
    expect(kitchen.status).toBe(403);
    cookieState.token = tokens.get(ownerId)!;
    const foreign = await counter(body({ restaurantId: otherRestaurantId }));
    expect(foreign.status).toBe(403);
    expect(foreign.data.trackingToken).toBeUndefined();
  });

  it('checks revoked permissions before replaying a previously created order', async () => {
    cookieState.token = tokens.get(secondCashierId)!;
    const key = requestKey(), original = await counter(body(), key);
    expect(original.status).toBe(201);
    const [assignment] = await d.select().from(s.userRoles).where(and(eq(s.userRoles.userId, secondCashierId), eq(s.userRoles.restaurantId, demo.restaurantId)));
    await d.delete(s.userRoles).where(eq(s.userRoles.id, assignment.id));
    try {
      const replay = await counter(body(), key);
      expect(replay.status).toBe(403);
      expect(replay.data.trackingToken).toBeUndefined();
    } finally {
      await assignRole(d, secondCashierId, 'CASHIER', demo.restaurantId);
    }
  });

  it('blocks external and opaque origins before mutating any orders', async () => {
    const [before] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
    for (const origin of ['https://evil.example', 'null', 'https://localhost']) {
      const response = await counter(body(), requestKey(), origin);
      expect(response.status).toBe(403);
      expect(response.data.error.code).toBe('FORBIDDEN');
    }
    const [after] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
    expect(after.orderSeq).toBe(before.orderSeq);
    expect(after.eventSeq).toBe(before.eventSeq);
  });

  it('calculates amounts on the server and records the authenticated user instead of a forged actor', async () => {
    const response = await counter(body({
      actor: { type: 'SYSTEM', userId: secondCashierId }, createdByUserId: secondCashierId,
      total: 1, subtotal: 1, commissionAmount: 0, paymentStatus: 'PAYMENT_VERIFIED',
      items: [{ ...body().items[0]!, unitPrice: 1, lineTotal: 1 }],
    }));
    expect(response.status).toBe(201);
    const order = await row(response.data.orderId);
    expect(order.total).toBeGreaterThan(1);
    expect(order.total).toBe(response.data.total);
    expect(order.paymentStatus).toBe('CASH');
    const [event] = await d.select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, order.id), eq(s.orderEvents.type, 'ORDER_CREATED')));
    expect(event.actorType).toBe('USER');
    expect(event.actorUserId).toBe(ownerId);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('requires payments.verify before recording cash received and never accepts that flag for InstaPay', async () => {
    cookieState.token = tokens.get(restrictedId)!;
    const restricted = await counter(body({ cashReceived: true }));
    expect(restricted.status).toBe(403);
    const unpaid = await counter(body({ cashReceived: false }));
    expect(unpaid.status).toBe(201);
    expect((await row(unpaid.data.orderId)).paymentStatus).toBe('CASH');
    cookieState.token = tokens.get(ownerId)!;
    const contradictory = await counter(body({ paymentMethod: 'INSTAPAY', cashReceived: true }));
    expect(contradictory.status).toBe(403);
    const received = await counter(body({ cashReceived: true, deliveryPointId: pickupPointId, customerPhone: null }));
    expect(received.status).toBe(201);
    const receivedOrder = await row(received.data.orderId);
    expect(receivedOrder.paymentStatus).toBe('PAYMENT_VERIFIED');
    expect(receivedOrder.status).toBe('CONFIRMED');
    expect(receivedOrder.fulfillmentType).toBe('PICKUP');
    expect(receivedOrder.customerPhone).toBeNull();
  });

  it('replays the same staff checkout once and rejects changed data including cash receipt', async () => {
    const key = requestKey(), input = body();
    const original = await counter(input, key);
    expect(original.status).toBe(201);
    const replay = await counter(input, key);
    expect(replay.status).toBe(200);
    expect(replay.data.orderId).toBe(original.data.orderId);
    expect(replay.data.replayed).toBe(true);
    for (const changed of [body({ customerName: 'Another person' }), body({ cashReceived: true })]) {
      const mismatch = await counter(changed, key);
      expect(mismatch.status).toBe(422);
      expect(mismatch.data.error.code).toBe('IDEMPOTENCY_MISMATCH');
      expect(mismatch.data.trackingToken).toBeUndefined();
    }
  });

  it('replays an unnamed counter checkout unchanged after the staff language switches', async () => {
    const key = requestKey(), input = body({ customerName: undefined, deliveryPointId: pickupPointId, customerPhone: null });
    const original = await counter(input, key, 'http://localhost', { cookie: 'staff_language=en', 'accept-language': 'en' });
    expect(original.status).toBe(201);
    const replay = await counter(input, key, 'http://localhost', { cookie: 'staff_language=ar', 'accept-language': 'ar-EG' });
    expect(replay.status).toBe(200);
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.orderId).toBe(original.data.orderId);
    expect(replay.data.trackingToken).toBe(original.data.trackingToken);
  });

  it('handles 100 simultaneous copies of one staff checkout with one order, payment and audit record', async () => {
    const key = requestKey(), input = body({ deliveryPointId: pickupPointId, customerPhone: null, cashReceived: true });
    const [before] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
    const responses = await Promise.all(Array.from({ length: 100 }, () => counter(input, key)));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 200 && response.data.replayed)).toHaveLength(99);
    expect(new Set(responses.map((response) => response.data.orderId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.data.trackingToken)).size).toBe(1);
    const orderId = responses[0]!.data.orderId;
    expect(await d.select().from(s.payments).where(eq(s.payments.orderId, orderId))).toHaveLength(1);
    expect(await d.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId))).toHaveLength(1);
    expect(await d.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, orderId), eq(s.auditLogs.action, 'order.counter_created')))).toHaveLength(1);
    const [after] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
    expect(after.orderSeq - before.orderSeq).toBe(1);
    expect(after.eventSeq - before.eventSeq).toBe(1);
  });

  it('derives pickup eligibility from a restaurant-owned point rather than a client fulfillment flag', async () => {
    const forged = await counter(body({ customerPhone: null, fulfillmentType: 'PICKUP' }));
    expect(forged.status).toBe(400); // Default external collection point still requires a phone.
    const [foreignPoint] = await d.select().from(s.deliveryPoints).where(eq(s.deliveryPoints.restaurantId, otherRestaurantId));
    const foreign = await counter(body({ deliveryPointId: foreignPoint.id }));
    expect(foreign.status).toBe(400);
    expect(foreign.data.trackingToken).toBeUndefined();
    const pickup = await counter(body({ deliveryPointId: pickupPointId, customerPhone: null }));
    expect(pickup.status).toBe(201);
    expect((await row(pickup.data.orderId)).fulfillmentType).toBe('PICKUP');
  });

  it('isolates another staff member using the same client key without exposing the first order token', async () => {
    const key = requestKey(), original = await counter(body(), key);
    expect(original.status).toBe(201);
    cookieState.token = tokens.get(secondCashierId)!;
    const other = await counter(body(), key);
    expect(other.status).toBe(201);
    expect(other.data.orderId).not.toBe(original.data.orderId);
    expect(other.data.trackingToken).not.toBe(original.data.trackingToken);
    const [event] = await d.select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, other.data.orderId), eq(s.orderEvents.type, 'ORDER_CREATED')));
    expect(event.actorUserId).toBe(secondCashierId);
  });

  it('does not trust guest-forged staff, cash receipt or amounts and keeps guest keys separate', async () => {
    const key = requestKey();
    const guestInput = body({ cashReceived: true, actor: { type: 'USER', userId: ownerId }, source: 'COUNTER', total: 1, paymentStatus: 'PAYMENT_VERIFIED' });
    const guest = await guestPost(new Request('http://localhost/api/public/stores/alrayez/orders', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-forwarded-for': '198.51.100.82' }, body: JSON.stringify(guestInput),
    }), { params: Promise.resolve({ slug: 'alrayez' }) });
    const guestData = await guest.json();
    expect(guest.status).toBe(201);
    const guestOrder = await row(guestData.orderId);
    expect(guestOrder.status).toBe('CREATED');
    expect(guestOrder.paymentStatus).toBe('CASH');
    expect(guestOrder.total).toBeGreaterThan(1);
    const [event] = await d.select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, guestOrder.id), eq(s.orderEvents.type, 'ORDER_CREATED')));
    expect(event.actorType).toBe('CUSTOMER');
    expect(event.actorUserId).toBeNull();
    const staff = await counter(body(), key);
    expect(staff.status).toBe(201);
    expect(staff.data.orderId).not.toBe(guestData.orderId);
    expect(staff.data.trackingToken).not.toBe(guestData.trackingToken);
  });

  it('cannot replay a counter order through guest checkout even with its full internal idempotency key', async () => {
    const created = await counter(body());
    expect(created.status).toBe(201);
    const order = await row(created.data.orderId);
    const response = await guestPost(new Request('http://localhost/api/public/stores/alrayez/orders', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': order.idempotencyKey, 'x-forwarded-for': '198.51.100.83' }, body: JSON.stringify(body()),
    }), { params: Promise.resolve({ slug: 'alrayez' }) });
    const data = await response.json();
    expect(response.status).toBe(422);
    expect(data.error.code).toBe('IDEMPOTENCY_MISMATCH');
    expect(data.trackingToken).toBeUndefined();
  });
});
