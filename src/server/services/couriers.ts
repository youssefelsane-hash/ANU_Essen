import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, isUniqueViolation, type Db } from '../db';
import { courierCashEntries, orders, restaurants, roles, userRoles, users } from '../db/schema';
import type { AuthContext } from '../auth/authz';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password';
import { hasPermission } from '../../lib/domain/permissions';
import { localDateString, localDateToUtc, startOfLocalDay } from '../../lib/domain/hours';
import { AppError } from '../errors';
import { audit } from './audit';
import { courierAccounting } from './stats';

export interface CourierActor {
  auth: AuthContext;
  ip?: string | null;
  userAgent?: string | null;
}

const actor = (a: CourierActor) => ({ type: 'USER' as const, userId: a.auth.user.id, label: a.auth.user.name });
const noteSchema = z.string().trim().max(300).nullable().optional();
const selectedRestaurantsSchema = z.array(z.uuid()).max(500).transform((ids) => [...new Set(ids)].sort());

function requirePlatformUsers(auth: AuthContext) {
  if (!auth.platformPermissions.has('platform.users')) throw new AppError('FORBIDDEN');
}

function requireCashManagement(auth: AuthContext, restaurantId: string) {
  if (!auth.platformPermissions.has('platform.finance') && !hasPermission(auth, 'couriers.cash', restaurantId)) throw new AppError('FORBIDDEN');
}

async function courierRole(d: Db) {
  const [role] = await d.select().from(roles).where(and(eq(roles.key, 'DELIVERY_STAFF'), eq(roles.scope, 'STORE')));
  if (!role) throw new AppError('INTERNAL', 'Delivery role is missing');
  return role;
}

async function validateRestaurantIds(d: Db, restaurantIds: string[]) {
  if (!restaurantIds.length) return;
  const rows = await d.select({ id: restaurants.id }).from(restaurants).where(inArray(restaurants.id, restaurantIds));
  if (rows.length !== restaurantIds.length) throw new AppError('VALIDATION', 'Unknown restaurant');
}

/** Lock the account holder, serializing hand-ins, reversals and assignment changes across stores. */
async function lockCourier(d: Db, userId: string) {
  const [user] = await d.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, userId)).for('update');
  if (!user) throw new AppError('NOT_FOUND');
  return user;
}

async function replaceAssignments(d: Db, userId: string, restaurantIds: string[]) {
  const role = await courierRole(d);
  await validateRestaurantIds(d, restaurantIds);
  const previous = await d.select({ id: userRoles.id, restaurantId: userRoles.restaurantId }).from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
  const removed = previous.filter((r) => r.restaurantId && !restaurantIds.includes(r.restaurantId));
  if (removed.length) {
    const [active] = await d.select({ id: orders.id }).from(orders).where(and(
      eq(orders.assignedToUserId, userId),
      inArray(orders.restaurantId, removed.map((r) => r.restaurantId!)),
      inArray(orders.status, ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE']),
    )).limit(1);
    if (active) throw new AppError('CONFLICT', 'Finish the courier’s active deliveries before removing a restaurant');
  }
  // Only this role is replaced. Owner/cashier/custom role assignments remain exactly as they were.
  await d.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
  if (restaurantIds.length) await d.insert(userRoles).values(restaurantIds.map((restaurantId) => ({ userId, roleId: role.id, restaurantId })));
  return { before: previous.map((r) => r.restaurantId).filter((id): id is string => !!id).sort(), after: restaurantIds };
}

export async function createCourier(input: { email: string; name: string; password: string; phone?: string | null; restaurantIds: string[]; actor: CourierActor }) {
  requirePlatformUsers(input.actor.auth);
  const email = z.email().parse(input.email.trim().toLowerCase());
  const name = z.string().trim().min(2).max(80).parse(input.name);
  const password = z.string().min(MIN_PASSWORD_LENGTH).max(200).parse(input.password);
  const phone = z.string().trim().max(40).nullable().optional().parse(input.phone) || null;
  const restaurantIds = selectedRestaurantsSchema.parse(input.restaurantIds);
  if (!restaurantIds.length) throw new AppError('VALIDATION', 'Select at least one restaurant');
  const passwordHash = await hashPassword(password);
  try {
    return await db().transaction(async (tx) => {
      await validateRestaurantIds(tx, restaurantIds);
      const [user] = await tx.insert(users).values({ email, name, phone, passwordHash }).returning({ id: users.id });
      await replaceAssignments(tx, user.id, restaurantIds);
      await audit({ actor: actor(input.actor), action: 'courier.created', entity: 'user', entityId: user.id,
        after: { email, name, restaurantIds }, ip: input.actor.ip, userAgent: input.actor.userAgent }, tx);
      return { userId: user.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', 'A user with this email already exists');
    throw err;
  }
}

/** Explicit selected store grants; never gives DELIVERY_STAFF a global/wildcard assignment. */
export async function setCourierRestaurants(input: { userId: string; restaurantIds: string[]; actor: CourierActor }) {
  requirePlatformUsers(input.actor.auth);
  const userId = z.uuid().parse(input.userId);
  const restaurantIds = selectedRestaurantsSchema.parse(input.restaurantIds);
  return db().transaction(async (tx) => {
    await lockCourier(tx, userId);
    const change = await replaceAssignments(tx, userId, restaurantIds);
    await audit({ actor: actor(input.actor), action: 'courier.restaurants_changed', entity: 'user', entityId: userId,
      before: { restaurantIds: change.before }, after: { restaurantIds: change.after }, ip: input.actor.ip, userAgent: input.actor.userAgent }, tx);
    return { userId, restaurantIds };
  });
}

/** Legacy Users/Staff screens must use the same claim/assignment mutex as courier management. */
export async function removeCourierAssignment(input: { assignmentId: string; origin: 'PLATFORM' | 'STORE'; actor: CourierActor }) {
  const assignmentId = z.uuid().parse(input.assignmentId);
  return db().transaction(async (tx) => {
    const [initial] = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.id, assignmentId));
    if (!initial) throw new AppError('NOT_FOUND');
    await lockCourier(tx, initial.userId);
    const [assignment] = await tx.select({ userId: userRoles.userId, restaurantId: userRoles.restaurantId, key: roles.key })
      .from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.id, assignmentId));
    if (!assignment) throw new AppError('NOT_FOUND');
    if (assignment.key !== 'DELIVERY_STAFF' || !assignment.restaurantId) throw new AppError('VALIDATION', 'Expected a restaurant courier assignment');
    if (input.origin === 'PLATFORM') requirePlatformUsers(input.actor.auth);
    else if (assignment.userId === input.actor.auth.user.id || !hasPermission(input.actor.auth, 'staff.manage', assignment.restaurantId)) throw new AppError('FORBIDDEN');
    const [active] = await tx.select({ id: orders.id }).from(orders).where(and(
      eq(orders.assignedToUserId, assignment.userId), eq(orders.restaurantId, assignment.restaurantId),
      inArray(orders.status, ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE']),
    )).limit(1);
    if (active) throw new AppError('CONFLICT', 'Finish the courier’s active deliveries before removing a restaurant');
    await tx.delete(userRoles).where(eq(userRoles.id, assignmentId));
    await audit({ actor: actor(input.actor), action: input.origin === 'PLATFORM' ? 'user.role_removed' : 'staff.role_removed',
      entity: 'user', entityId: assignment.userId, restaurantId: assignment.restaurantId, before: { role: assignment.key },
      ip: input.actor.ip, userAgent: input.actor.userAgent }, tx);
    return { userId: assignment.userId, restaurantId: assignment.restaurantId };
  });
}

type CashEntry = typeof courierCashEntries.$inferSelect;
function replayEntry(existing: CashEntry, expected: Pick<CashEntry, 'restaurantId' | 'courierUserId' | 'entryKind' | 'amount' | 'note' | 'reversesEntryId'>, auth: AuthContext) {
  if (existing.recordedByUserId !== auth.user.id || existing.restaurantId !== expected.restaurantId || existing.courierUserId !== expected.courierUserId) throw new AppError('FORBIDDEN');
  if (existing.entryKind !== expected.entryKind || existing.amount !== expected.amount || existing.note !== expected.note || existing.reversesEntryId !== expected.reversesEntryId) {
    throw new AppError('IDEMPOTENCY_MISMATCH');
  }
  return { handInId: existing.id, result: 'duplicate' as const };
}

export async function recordCourierHandIn(input: { restaurantId: string; courierUserId: string; amount: number; idempotencyKey: string; note?: string | null; actor: CourierActor }) {
  const restaurantId = z.uuid().parse(input.restaurantId);
  const courierUserId = z.uuid().parse(input.courierUserId);
  requireCashManagement(input.actor.auth, restaurantId);
  const amount = z.number().int().positive().max(2_147_483_647).parse(input.amount);
  const idempotencyKey = z.uuid().parse(input.idempotencyKey);
  const note = noteSchema.parse(input.note) || null;
  const expected = { restaurantId, courierUserId, amount, note, entryKind: 'HAND_IN' as const, reversesEntryId: null };
  return db().transaction(async (tx) => {
    await lockCourier(tx, courierUserId);
    const [existing] = await tx.select().from(courierCashEntries).where(eq(courierCashEntries.idempotencyKey, idempotencyKey));
    if (existing) return replayEntry(existing, expected, input.actor.auth);
    const balance = (await courierAccounting(tx, restaurantId, courierUserId))[0];
    const outstanding = balance?.outstanding ?? 0;
    if (amount > outstanding) throw new AppError('CONFLICT', 'المبلغ أكبر من النقدية المتبقية مع المندوب', { outstanding });
    const [entry] = await tx.insert(courierCashEntries).values({ ...expected, idempotencyKey, recordedByUserId: input.actor.auth.user.id }).returning({ id: courierCashEntries.id });
    await audit({ actor: actor(input.actor), action: 'courier.cash_received', entity: 'courier_cash_entry', entityId: entry.id, restaurantId,
      before: { outstanding }, after: { courierUserId, amount, outstanding: outstanding - amount, note }, ip: input.actor.ip, userAgent: input.actor.userAgent }, tx);
    return { handInId: entry.id, result: 'applied' as const };
  }).catch(async (err) => {
    if (isUniqueViolation(err, 'courier_cash_entries_idempotency_key_unique')) {
      const [existing] = await db().select().from(courierCashEntries).where(eq(courierCashEntries.idempotencyKey, idempotencyKey));
      if (existing) return replayEntry(existing, expected, input.actor.auth);
    }
    throw err;
  });
}

/** Correct a mistaken receipt by appending its exact opposite, once; never edit/delete money history. */
export async function reverseCourierHandIn(input: { handInId: string; idempotencyKey: string; note: string; actor: CourierActor }) {
  const handInId = z.uuid().parse(input.handInId);
  const idempotencyKey = z.uuid().parse(input.idempotencyKey);
  const note = z.string().trim().min(3).max(300).parse(input.note);
  return db().transaction(async (tx) => {
    const [original] = await tx.select().from(courierCashEntries).where(eq(courierCashEntries.id, handInId));
    if (!original) throw new AppError('NOT_FOUND');
    requireCashManagement(input.actor.auth, original.restaurantId);
    await lockCourier(tx, original.courierUserId);
    if (original.entryKind !== 'HAND_IN') throw new AppError('CONFLICT', 'Only an original hand-in can be reversed');
    const expected = { restaurantId: original.restaurantId, courierUserId: original.courierUserId, amount: original.amount, note, entryKind: 'REVERSAL' as const, reversesEntryId: original.id };
    const [existing] = await tx.select().from(courierCashEntries).where(eq(courierCashEntries.idempotencyKey, idempotencyKey));
    if (existing) return replayEntry(existing, expected, input.actor.auth);
    const [reversed] = await tx.select({ id: courierCashEntries.id }).from(courierCashEntries).where(eq(courierCashEntries.reversesEntryId, original.id));
    if (reversed) throw new AppError('CONFLICT', 'This hand-in was already reversed');
    const [entry] = await tx.insert(courierCashEntries).values({ ...expected, idempotencyKey, recordedByUserId: input.actor.auth.user.id }).returning({ id: courierCashEntries.id });
    await audit({ actor: actor(input.actor), action: 'courier.cash_reversed', entity: 'courier_cash_entry', entityId: entry.id, restaurantId: original.restaurantId,
      before: { handInId: original.id, amount: original.amount }, after: { courierUserId: original.courierUserId, reversesEntryId: original.id, note }, ip: input.actor.ip, userAgent: input.actor.userAgent }, tx);
    return { handInId: entry.id, result: 'applied' as const };
  });
}

async function cashHistory(d: Db, restaurantId?: string) {
  const courier = alias(users, 'cash_courier');
  const recorder = alias(users, 'cash_recorder');
  const reversal = alias(courierCashEntries, 'cash_reversal');
  return d.select({
    id: courierCashEntries.id, restaurantId: courierCashEntries.restaurantId,
    restaurantNameAr: restaurants.nameAr, restaurantNameEn: restaurants.nameEn,
    courierUserId: courierCashEntries.courierUserId, courierName: courier.name,
    entryKind: courierCashEntries.entryKind, amount: courierCashEntries.amount, note: courierCashEntries.note,
    recordedByName: recorder.name, createdAt: courierCashEntries.createdAt,
    reversesEntryId: courierCashEntries.reversesEntryId, reversed: sql<boolean>`${reversal.id} is not null`,
  }).from(courierCashEntries)
    .innerJoin(restaurants, eq(restaurants.id, courierCashEntries.restaurantId))
    .innerJoin(courier, eq(courier.id, courierCashEntries.courierUserId))
    .leftJoin(recorder, eq(recorder.id, courierCashEntries.recordedByUserId))
    .leftJoin(reversal, eq(reversal.reversesEntryId, courierCashEntries.id))
    .where(restaurantId ? eq(courierCashEntries.restaurantId, restaurantId) : undefined)
    .orderBy(desc(courierCashEntries.createdAt)).limit(200);
}

export async function merchantCourierOverview(d: Db, auth: AuthContext, restaurantId: string) {
  z.uuid().parse(restaurantId);
  requireCashManagement(auth, restaurantId);
  const [rawBalances, handIns] = await Promise.all([courierAccounting(d, restaurantId), cashHistory(d, restaurantId)]);
  // Restaurant-side cash screens need collection totals, never the platform's
  // internal share of those totals.
  const balances = rawBalances.map(({ platformShare: _platformShare, merchantShare: _merchantShare, ...balance }) => balance);
  return { balances, handIns };
}

export async function platformCourierOverview(d: Db, auth: AuthContext) {
  const canUsers = auth.platformPermissions.has('platform.users');
  const canFinance = auth.platformPermissions.has('platform.finance');
  if (!canUsers && !canFinance) throw new AppError('FORBIDDEN');
  const [restaurantList, candidates, assignments, balances, handIns] = await Promise.all([
    d.select({ id: restaurants.id, nameAr: restaurants.nameAr, nameEn: restaurants.nameEn, isActive: restaurants.isActive }).from(restaurants).orderBy(asc(restaurants.nameEn)),
    canUsers ? d.select({ userId: users.id, name: users.name, email: users.email, isActive: users.isActive }).from(users).orderBy(asc(users.name)) : [],
    canUsers ? d.select({ userId: users.id, name: users.name, email: users.email, isActive: users.isActive, restaurantId: userRoles.restaurantId })
      .from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(roles.key, 'DELIVERY_STAFF'), eq(roles.scope, 'STORE'))) : [],
    canFinance ? courierAccounting(d) : [],
    canFinance ? cashHistory(d) : [],
  ]);
  const couriers = [...new Set(assignments.map((r) => r.userId))].map((userId) => {
    const rows = assignments.filter((r) => r.userId === userId);
    return { userId, name: rows[0].name, email: rows[0].email, isActive: rows[0].isActive,
      restaurantIds: rows.map((r) => r.restaurantId).filter((id): id is string => !!id).sort() };
  });
  return { couriers, candidates: candidates.filter((u) => u.isActive), restaurants: restaurantList, balances, handIns };
}

/** Personal courier report: the caller cannot select another courier, even when they own a store. */
export async function courierCashReport(d: Db, auth: AuthContext, restaurantId: string, now = new Date()) {
  z.uuid().parse(restaurantId);
  if (!hasPermission(auth, 'orders.delivery', restaurantId)) throw new AppError('FORBIDDEN');
  const [restaurant] = await d.select({ nameAr: restaurants.nameAr, nameEn: restaurants.nameEn, timezone: restaurants.timezone })
    .from(restaurants).where(eq(restaurants.id, restaurantId));
  if (!restaurant) throw new AppError('NOT_FOUND');
  const from = startOfLocalDay(now, restaurant.timezone);
  const next = new Date(`${localDateString(now, restaurant.timezone)}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const to = localDateToUtc(next.toISOString().slice(0, 10), restaurant.timezone);
  const balance = (await courierAccounting(d, restaurantId, auth.user.id, { from, to }))[0];
  return {
    serverTime: now.getTime(), restaurantId, nameAr: restaurant.nameAr, nameEn: restaurant.nameEn,
    dayStart: from.toISOString(), dayEnd: to.toISOString(),
    cashCollected: balance?.cashCollected ?? 0, cashOutstanding: balance?.outstanding ?? 0,
    ordersCompleted: balance?.delivered ?? 0, cashPending: balance?.cashPending ?? 0,
    handedIn: balance?.handedIn ?? 0, cashRefunds: balance?.cashRefunds ?? 0,
  };
}
