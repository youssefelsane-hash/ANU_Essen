import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { Db } from '@/server/db';
import * as s from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/authz';
import { loadAuthz } from '@/server/auth/authz';
import { verifyPassword } from '@/server/auth/password';
import { AppError } from '@/server/errors';
import { assignRole, bootstrapRestaurant, ensureUser, type DemoSeedResult } from '@/server/seed';
import { createCounterOrder, createOrder } from '@/server/services/checkout';
import { applyOrderAction, type ActionActor } from '@/server/services/order-actions';
import { createCourier, courierCashReport, merchantCourierOverview, platformCourierOverview, recordCourierHandIn, reverseCourierHandIn, setCourierRestaurants } from '@/server/services/couriers';
import { recordRefund } from '@/server/services/refunds';
import { courierSummary } from '@/server/services/stats';
import { startOfLocalDay } from '@/lib/domain/hours';
import { hasPermission } from '@/lib/domain/permissions';
import { authFor, setupTestDb, TEST_PASSWORD } from './helpers/db';

let d: Db, client: PGlite, demo: DemoSeedResult;
let admin: AuthContext, owner: AuthContext, owner2: AuthContext, cashier: AuthContext, kitchen: AuthContext, delivery: AuthContext;
let second: typeof s.restaurants.$inferSelect, secondProduct: string;
let phone = 0;
const key = () => crypto.randomUUID();
const actor = (auth: AuthContext) => ({ auth });
const actionActor = (auth: AuthContext): ActionActor => ({ type: 'USER', userId: auth.user.id, label: auth.user.name, auth });
const code = (p: Promise<unknown>, expected: string) => expect(p).rejects.toSatisfy((err: unknown) => err instanceof AppError && err.code === expected);

beforeEach(async () => {
  ({ d, client, demo } = await setupTestDb());
  [admin, owner, cashier, kitchen, delivery] = await Promise.all([
    authFor(d, 'admin@test.local'), authFor(d, 'owner@alrayez.test'), authFor(d, 'cashier@alrayez.test'), authFor(d, 'kitchen@alrayez.test'), authFor(d, 'delivery@alrayez.test'),
  ]);
  second = await bootstrapRestaurant(d, { slug: 'second-store', nameAr: 'المطعم الثاني', nameEn: 'Second restaurant', commissionBps: 1000 });
  await d.insert(s.deliveryPoints).values({ restaurantId: second.id, nameAr: 'الجامعة', nameEn: 'University', kind: 'DELIVERY', isDefault: true });
  const [category] = await d.insert(s.categories).values({ restaurantId: second.id, nameAr: 'المنيو', nameEn: 'Menu' }).returning();
  const [product] = await d.insert(s.products).values({ restaurantId: second.id, categoryId: category.id, nameAr: 'وجبة', nameEn: 'Meal', basePrice: 10000 }).returning();
  secondProduct = product.id;
  const otherOwner = await ensureUser(d, { email: 'owner2@test.local', name: 'Other owner', password: TEST_PASSWORD });
  await assignRole(d, otherOwner.id, 'MERCHANT_OWNER', second.id);
  owner2 = await loadAuthz(d, otherOwner);
  await setCourierRestaurants({ userId: delivery.user.id, restaurantIds: [demo.restaurantId, second.id], actor: actor(admin) });
  delivery = await authFor(d, delivery.user.email);
});

afterEach(async () => { await client?.close(); });

async function createReady(store = demo.restaurantId, paymentMethod: 'CASH' | 'INSTAPAY' = 'CASH') {
  const inDemo = store === demo.restaurantId;
  const items = inDemo
    ? [{ productId: demo.productIds['Chicken Shawarma Sandwich'], variantId: demo.variantIds['Chicken Shawarma Sandwich:Regular'], addonIds: [], quantity: 1 }]
    : [{ productId: secondProduct, addonIds: [], quantity: 1 }];
  const order = await createOrder(inDemo ? 'alrayez' : second.slug, { items, customerName: 'Customer', customerPhone: `010${String(++phone).padStart(8, '0')}`, paymentMethod }, key());
  if (paymentMethod === 'INSTAPAY') {
    await applyOrderAction({ orderId: order.orderId, action: 'SUBMIT_PAYMENT', actor: { type: 'CUSTOMER', label: 'Customer' } });
    await applyOrderAction({ orderId: order.orderId, action: 'VERIFY_PAYMENT', actor: actionActor(inDemo ? owner : owner2) });
  }
  await applyOrderAction({ orderId: order.orderId, action: 'MARK_READY', actor: actionActor(inDemo ? kitchen : owner2) });
  return order;
}

async function takeAndComplete(orderId: string, courier = delivery) {
  await applyOrderAction({ orderId, action: 'OUT_FOR_DELIVERY', actor: actionActor(courier) });
  await applyOrderAction({ orderId, action: 'COMPLETE', actor: actionActor(courier) });
}

describe('shared couriers with explicit restaurant grants', () => {
  it('creates selected store grants, preserves unrelated roles and never assigns a global delivery role', async () => {
    const created = await createCourier({ email: 'shared@test.local', name: 'Shared courier', password: TEST_PASSWORD, restaurantIds: [second.id, demo.restaurantId, second.id], actor: actor(admin) });
    const auth = await authFor(d, 'shared@test.local');
    expect(auth.storeIds.sort()).toEqual([demo.restaurantId, second.id].sort());
    expect(hasPermission(auth, 'orders.delivery', demo.restaurantId)).toBe(true);
    expect(hasPermission(auth, 'orders.delivery', crypto.randomUUID())).toBe(false);
    expect(auth.platformPermissions.size).toBe(0);
    const [user] = await d.select().from(s.users).where(eq(s.users.id, created.userId));
    expect(user.passwordHash).not.toBe(TEST_PASSWORD);
    expect(await verifyPassword(TEST_PASSWORD, user.passwordHash)).toBe(true);
    await assignRole(d, created.userId, 'CASHIER', demo.restaurantId);
    await setCourierRestaurants({ userId: created.userId, restaurantIds: [second.id], actor: actor(admin) });
    const changed = await authFor(d, 'shared@test.local');
    expect(hasPermission(changed, 'orders.create', demo.restaurantId)).toBe(true);
    const [role] = await d.select().from(s.roles).where(eq(s.roles.key, 'DELIVERY_STAFF'));
    const grants = await d.select().from(s.userRoles).where(and(eq(s.userRoles.userId, created.userId), eq(s.userRoles.roleId, role.id)));
    expect(grants.map((r) => r.restaurantId)).toEqual([second.id]);
    expect(await d.select().from(s.userRoles).where(and(eq(s.userRoles.roleId, role.id), isNull(s.userRoles.restaurantId)))).toHaveLength(0);
    await code(setCourierRestaurants({ userId: created.userId, restaurantIds: [crypto.randomUUID()], actor: actor(admin) }), 'VALIDATION');
    expect((await authFor(d, 'shared@test.local')).storeIds.sort()).toEqual([demo.restaurantId, second.id].sort());
    await code(createCourier({ email: 'shared@test.local', name: 'Duplicate', password: TEST_PASSWORD, restaurantIds: [second.id], actor: actor(admin) }), 'CONFLICT');
    const audits = await d.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, created.userId));
    expect(audits.map((a) => a.action)).toEqual(['courier.created', 'courier.restaurants_changed']);
    expect(JSON.stringify(audits)).not.toContain(TEST_PASSWORD);
  });

  it('separates user management, platform finance, owner cash, and a courier’s own tenant-scoped report', async () => {
    await code(setCourierRestaurants({ userId: delivery.user.id, restaurantIds: [second.id], actor: actor(owner) }), 'FORBIDDEN');
    await code(createCourier({ email: 'no@test.local', name: 'No user', password: TEST_PASSWORD, restaurantIds: [second.id], actor: actor(owner) }), 'FORBIDDEN');
    const usersOnly = { ...admin, platformPermissions: new Set(['platform.users']) };
    const financeOnly = { ...admin, platformPermissions: new Set(['platform.finance']) };
    const usersView = await platformCourierOverview(d, usersOnly);
    expect(usersView.couriers.find((c) => c.userId === delivery.user.id)?.restaurantIds.sort()).toEqual([demo.restaurantId, second.id].sort());
    expect(usersView.candidates.some((u) => u.userId === owner.user.id)).toBe(true);
    expect(usersView.balances).toEqual([]);
    expect(usersView.handIns).toEqual([]);
    expect(JSON.stringify(usersView)).not.toContain('passwordHash');
    const financeView = await platformCourierOverview(d, financeOnly);
    expect(financeView.couriers).toEqual([]);
    expect(financeView.candidates).toEqual([]);
    expect(financeView.balances).not.toHaveLength(0);
    await code(platformCourierOverview(d, owner), 'FORBIDDEN');
    await code(merchantCourierOverview(d, owner, second.id), 'FORBIDDEN');
    await code(merchantCourierOverview(d, cashier, demo.restaurantId), 'FORBIDDEN');
    await code(merchantCourierOverview(d, delivery, demo.restaurantId), 'FORBIDDEN');
    expect((await merchantCourierOverview(d, owner, demo.restaurantId)).balances.every((b) => b.restaurantId === demo.restaurantId)).toBe(true);
    await code(courierCashReport(d, delivery, crypto.randomUUID()), 'FORBIDDEN');
    expect((await courierCashReport(d, delivery, second.id)).cashCollected).toBe(0);
  });
});

describe('per-restaurant physical cash accounting', () => {
  it('separates shared-courier stores, excludes paid transfers and pickup, and preserves base/fee shares', async () => {
    const first = await createReady();
    const other = await createReady(second.id);
    await takeAndComplete(first.orderId);
    await takeAndComplete(other.orderId);
    const transfer = await createReady(demo.restaurantId, 'INSTAPAY');
    await takeAndComplete(transfer.orderId);
    const pending = await createReady();
    await applyOrderAction({ orderId: pending.orderId, action: 'OUT_FOR_DELIVERY', actor: actionActor(delivery) });
    const [pickup] = await d.select().from(s.deliveryPoints).where(and(eq(s.deliveryPoints.restaurantId, demo.restaurantId), eq(s.deliveryPoints.kind, 'PICKUP')));
    const walkIn = await createCounterOrder(demo.restaurantId, { paymentMethod: 'CASH', deliveryPointId: pickup.id, items: [{ productId: demo.productIds['Chicken Shawarma Sandwich'], variantId: demo.variantIds['Chicken Shawarma Sandwich:Regular'], quantity: 1, addonIds: [] }] }, key(), { userId: cashier.user.id, name: cashier.user.name, auth: cashier });
    await applyOrderAction({ orderId: walkIn.orderId, action: 'MARK_READY', actor: actionActor(kitchen) });
    await applyOrderAction({ orderId: walkIn.orderId, action: 'COMPLETE', actor: actionActor(cashier) });
    // A historical/staff-assigned pickup must never become a courier cash debt.
    await d.update(s.orders).set({ assignedToUserId: delivery.user.id }).where(eq(s.orders.id, walkIn.orderId));
    const a = (await merchantCourierOverview(d, owner, demo.restaurantId)).balances.find((b) => b.userId === delivery.user.id)!;
    const b = (await merchantCourierOverview(d, owner2, second.id)).balances.find((x) => x.userId === delivery.user.id)!;
    expect(a).toMatchObject({ cashCollected: first.total, cashPending: pending.total, outstanding: first.total, delivered: 2, onTheWay: 1 });
    expect(a).not.toHaveProperty('platformShare');
    expect(a).not.toHaveProperty('merchantShare');
    expect(b).toMatchObject({ cashCollected: other.total, outstanding: other.total, delivered: 1 });
    expect(b).not.toHaveProperty('platformShare');
    expect(b).not.toHaveProperty('merchantShare');
    const platformBalances = (await platformCourierOverview(d, admin)).balances;
    const platformA = platformBalances.find((row) => row.restaurantId === demo.restaurantId && row.userId === delivery.user.id)!;
    const platformB = platformBalances.find((row) => row.restaurantId === second.id && row.userId === delivery.user.id)!;
    expect(platformA.merchantShare + platformA.platformShare).toBe(first.total);
    expect(platformA.platformShare).toBe(300);
    expect(platformB).toMatchObject({ merchantShare: 10000, platformShare: 1000 });
    const personal = await courierCashReport(d, delivery, demo.restaurantId);
    expect(personal).toMatchObject({ restaurantId: demo.restaurantId, cashCollected: first.total, cashOutstanding: first.total, ordersCompleted: 2 });
    expect(personal).not.toHaveProperty('platformShare');
    expect(personal).not.toHaveProperty('merchantShare');
  });

  it('records hand-ins exactly once, rejects overpayments and blocks cross-store/cross-actor key reuse', async () => {
    const o = await createReady();
    await takeAndComplete(o.orderId);
    const idempotencyKey = key();
    const input = { restaurantId: demo.restaurantId, courierUserId: delivery.user.id, amount: 2000, idempotencyKey, note: 'Shift cash', actor: actor(owner) };
    const first = await recordCourierHandIn(input);
    expect((await recordCourierHandIn(input))).toMatchObject({ result: 'duplicate', handInId: first.handInId });
    await code(recordCourierHandIn({ ...input, amount: 2001 }), 'IDEMPOTENCY_MISMATCH');
    await code(recordCourierHandIn({ ...input, actor: actor(admin) }), 'FORBIDDEN');
    await code(recordCourierHandIn({ ...input, restaurantId: second.id }), 'FORBIDDEN');
    await code(recordCourierHandIn({ ...input, actor: actor(cashier), idempotencyKey: key() }), 'FORBIDDEN');
    await code(recordCourierHandIn({ ...input, actor: actor(delivery), idempotencyKey: key() }), 'FORBIDDEN');
    await code(recordCourierHandIn({ ...input, amount: o.total, idempotencyKey: key() }), 'CONFLICT');
    expect(await d.select().from(s.courierCashEntries)).toHaveLength(1);
    expect(await d.select().from(s.auditLogs).where(eq(s.auditLogs.action, 'courier.cash_received'))).toHaveLength(1);
    const results = await Promise.allSettled([4000, 4000].map((amount) => recordCourierHandIn({ ...input, amount, idempotencyKey: key(), note: null })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const balance = (await merchantCourierOverview(d, owner, demo.restaurantId)).balances[0];
    expect(balance).toMatchObject({ handedIn: 6000, outstanding: o.total - 6000 });
  });

  it('keeps restaurant-funded refunds separate and appends a single exact correction without deleting history', async () => {
    const o = await createReady();
    await takeAndComplete(o.orderId);
    await recordRefund({ orderId: o.orderId, method: 'CASH', amount: 1000, actor: { userId: owner.user.id, name: owner.user.name, auth: owner } });
    const before = (await merchantCourierOverview(d, owner, demo.restaurantId)).balances[0];
    expect(before).toMatchObject({ cashCollected: o.total, cashRefunds: 1000, outstanding: o.total });
    const original = await recordCourierHandIn({ restaurantId: demo.restaurantId, courierUserId: delivery.user.id, amount: 4000, idempotencyKey: key(), note: 'Mistyped amount', actor: actor(owner) });
    const [snapshot] = await d.select().from(s.courierCashEntries).where(eq(s.courierCashEntries.id, original.handInId));
    const reversal = { handInId: original.handInId, idempotencyKey: key(), note: 'Wrong amount entered', actor: actor(owner) };
    await code(reverseCourierHandIn({ ...reversal, actor: actor(owner2) }), 'FORBIDDEN');
    const reversed = await reverseCourierHandIn(reversal);
    expect((await reverseCourierHandIn(reversal)).result).toBe('duplicate');
    await code(reverseCourierHandIn({ ...reversal, idempotencyKey: key() }), 'CONFLICT');
    await code(reverseCourierHandIn({ ...reversal, handInId: reversed.handInId, idempotencyKey: key() }), 'CONFLICT');
    expect((await d.select().from(s.courierCashEntries).where(eq(s.courierCashEntries.id, original.handInId)))[0]).toEqual(snapshot);
    const view = await merchantCourierOverview(d, owner, demo.restaurantId);
    expect(view.balances[0]).toMatchObject({ handedIn: 0, outstanding: o.total, cashRefunds: 1000 });
    expect(view.handIns.find((r) => r.id === original.handInId)).toMatchObject({ entryKind: 'HAND_IN', reversed: true });
    expect(view.handIns.find((r) => r.id === reversed.handInId)).toMatchObject({ entryKind: 'REVERSAL', amount: 4000, reversesEntryId: original.handInId });
    await recordCourierHandIn({ restaurantId: demo.restaurantId, courierUserId: delivery.user.id, amount: o.total, idempotencyKey: key(), actor: actor(admin) });
    expect((await merchantCourierOverview(d, owner, demo.restaurantId)).balances[0].outstanding).toBe(0);
    expect(await d.select().from(s.auditLogs).where(eq(s.auditLogs.action, 'courier.cash_reversed'))).toHaveLength(1);
  });

  it('counts cash by completion day and keeps older in-flight collections and outstanding balances visible', async () => {
    const now = new Date();
    const dayStart = startOfLocalDay(now, 'Africa/Cairo');
    const oldCreated = new Date(dayStart.getTime() - 3_600_000);
    const delivered = await createReady();
    const pending = await createReady();
    await d.update(s.orders).set({ createdAt: oldCreated }).where(eq(s.orders.id, delivered.orderId));
    await d.update(s.orders).set({ createdAt: oldCreated }).where(eq(s.orders.id, pending.orderId));
    await takeAndComplete(delivered.orderId);
    await applyOrderAction({ orderId: pending.orderId, action: 'OUT_FOR_DELIVERY', actor: actionActor(delivery) });
    const report = await courierCashReport(d, delivery, demo.restaurantId, new Date());
    expect(report).toMatchObject({ cashCollected: delivered.total, cashOutstanding: delivered.total, cashPending: pending.total, ordersCompleted: 1 });
    const daily = (await courierSummary(d, demo.restaurantId, dayStart, new Date(Date.now() + 60_000))).find((r) => r.userId === delivery.user.id)!;
    expect(daily).toMatchObject({ cashCollected: delivered.total, cashPending: pending.total, delivered: 1 });
    expect(daily).not.toHaveProperty('platformShare');
    expect(daily).not.toHaveProperty('merchantShare');
    await d.update(s.orders).set({ completedAt: oldCreated }).where(eq(s.orders.id, delivered.orderId));
    const next = await courierCashReport(d, delivery, demo.restaurantId);
    expect(next).toMatchObject({ cashCollected: 0, cashOutstanding: delivered.total, cashPending: pending.total, ordersCompleted: 0 });
  });
});

describe('revocations and concurrent delivery claims', () => {
  it('blocks removing a restaurant while a delivery is in flight and keeps its cash history after removal', async () => {
    const o = await createReady();
    await applyOrderAction({ orderId: o.orderId, action: 'OUT_FOR_DELIVERY', actor: actionActor(delivery) });
    await code(setCourierRestaurants({ userId: delivery.user.id, restaurantIds: [second.id], actor: actor(admin) }), 'CONFLICT');
    await applyOrderAction({ orderId: o.orderId, action: 'COMPLETE', actor: actionActor(delivery) });
    await setCourierRestaurants({ userId: delivery.user.id, restaurantIds: [second.id], actor: actor(admin) });
    const fresh = await authFor(d, delivery.user.email);
    await code(courierCashReport(d, fresh, demo.restaurantId), 'FORBIDDEN');
    expect((await merchantCourierOverview(d, owner, demo.restaurantId)).balances[0].outstanding).toBe(o.total);
    await recordCourierHandIn({ restaurantId: demo.restaurantId, courierUserId: delivery.user.id, amount: o.total, idempotencyKey: key(), actor: actor(owner) });
    expect((await merchantCourierOverview(d, owner, demo.restaurantId)).balances[0].outstanding).toBe(0);
  });

  it('rejects a stale authorization snapshot after revocation, while a platform courier claim remains valid', async () => {
    const o = await createReady();
    const stale = delivery;
    await setCourierRestaurants({ userId: delivery.user.id, restaurantIds: [second.id], actor: actor(admin) });
    await code(applyOrderAction({ orderId: o.orderId, action: 'OUT_FOR_DELIVERY', actor: actionActor(stale) }), 'FORBIDDEN');
    expect((await d.select().from(s.orders).where(eq(s.orders.id, o.orderId)))[0]).toMatchObject({ status: 'READY', assignedToUserId: null });
    await applyOrderAction({ orderId: o.orderId, action: 'OUT_FOR_DELIVERY', actor: actionActor(admin) });
    expect((await d.select().from(s.orders).where(eq(s.orders.id, o.orderId)))[0].assignedToUserId).toBe(admin.user.id);
  });

  it('lets only one of two couriers claim the same ready order and prevents the other from completing it', async () => {
    const other = await ensureUser(d, { email: 'other-courier@test.local', name: 'Other courier', password: TEST_PASSWORD });
    await assignRole(d, other.id, 'DELIVERY_STAFF', demo.restaurantId);
    const otherAuth = await loadAuthz(d, other);
    const o = await createReady();
    const results = await Promise.allSettled([delivery, otherAuth].map((auth) => applyOrderAction({ orderId: o.orderId, action: 'OUT_FOR_DELIVERY', actor: actionActor(auth) })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    const loser = row.assignedToUserId === delivery.user.id ? otherAuth : delivery;
    await code(applyOrderAction({ orderId: o.orderId, action: 'COMPLETE', actor: actionActor(loser) }), 'FORBIDDEN');
    const claims = await d.select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, o.orderId), eq(s.orderEvents.action, 'OUT_FOR_DELIVERY')));
    expect(claims).toHaveLength(1);
  });
});
