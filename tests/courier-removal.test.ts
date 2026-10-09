import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeRoleAction } from '@/server/actions/admin-platform';
import { removeStaffRoleAction } from '@/server/actions/merchant';
import { removeCourierAssignment } from '@/server/services/couriers';
import { createOrder } from '@/server/services/checkout';
import { applyOrderAction } from '@/server/services/order-actions';
import { AppError } from '@/server/errors';
import * as s from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/authz';
import { authFor, setupTestDb } from './helpers/db';

const requestCookies = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (key: string) => requestCookies.has(key) ? { value: requestCookies.get(key) } : undefined, set: (key: string, value: string) => requestCookies.set(key, value) }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: () => {} }));

let fixture: Awaited<ReturnType<typeof setupTestDb>>;
const staff = (auth: AuthContext) => ({ type: 'USER' as const, userId: auth.user.id, label: auth.user.name, auth });
const code = (promise: Promise<unknown>, expected: string) => expect(promise).rejects.toSatisfy((err: unknown) => err instanceof AppError && err.code === expected);

beforeEach(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://unused:unused@localhost/unused');
  requestCookies.clear();
  fixture = await setupTestDb();
});
afterEach(async () => { await fixture.client.close(); vi.unstubAllEnvs(); });

async function session(auth: AuthContext) {
  const token = crypto.randomUUID();
  await fixture.d.insert(s.sessions).values({ id: createHash('sha256').update(token).digest('hex'), userId: auth.user.id, expiresAt: new Date(Date.now() + 86_400_000) });
  requestCookies.set('sid', token);
}

async function courierGrant() {
  const courier = await authFor(fixture.d, 'delivery@alrayez.test');
  const [role] = await fixture.d.select().from(s.roles).where(eq(s.roles.key, 'DELIVERY_STAFF'));
  const [assignment] = await fixture.d.select().from(s.userRoles).where(and(eq(s.userRoles.userId, courier.user.id), eq(s.userRoles.roleId, role.id), eq(s.userRoles.restaurantId, fixture.demo.restaurantId)));
  return { courier, assignment };
}

describe('legacy role removal screens share the courier assignment transaction', () => {
  it.each([
    { screen: 'platform Users', email: 'admin@test.local', remove: removeRoleAction },
    { screen: 'merchant Staff', email: 'owner@alrayez.test', remove: removeStaffRoleAction },
  ])('blocks $screen from removing an in-flight courier, then removes only that grant with one audit', async ({ email, remove }) => {
    const { d, demo } = fixture;
    const operator = await authFor(d, email);
    const kitchen = await authFor(d, 'kitchen@alrayez.test');
    const { courier, assignment } = await courierGrant();
    await session(operator);
    const order = await createOrder('alrayez', {
      items: [{ productId: demo.productIds['Chicken Shawarma Sandwich'], variantId: demo.variantIds['Chicken Shawarma Sandwich:Regular'], addonIds: [], quantity: 1 }],
      customerName: 'Delivery customer', customerPhone: '01000000001', paymentMethod: 'CASH',
    }, crypto.randomUUID());
    await applyOrderAction({ orderId: order.orderId, action: 'MARK_READY', actor: staff(kitchen) });
    await applyOrderAction({ orderId: order.orderId, action: 'OUT_FOR_DELIVERY', actor: staff(courier) });
    await code(remove(assignment.id), 'CONFLICT');
    expect(await d.select().from(s.userRoles).where(eq(s.userRoles.id, assignment.id))).toHaveLength(1);
    await applyOrderAction({ orderId: order.orderId, action: 'MARK_ARRIVED', actor: staff(courier) });
    await code(remove(assignment.id), 'CONFLICT');
    await applyOrderAction({ orderId: order.orderId, action: 'COMPLETE', actor: staff(courier) });
    await remove(assignment.id);
    expect(await d.select().from(s.userRoles).where(eq(s.userRoles.id, assignment.id))).toHaveLength(0);
    const logs = await d.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, courier.user.id), eq(s.auditLogs.action, email.startsWith('admin') ? 'user.role_removed' : 'staff.role_removed')));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorUserId: operator.user.id, restaurantId: demo.restaurantId });
  });

  it('does not let a scoped staff actor invoke the platform removal path or remove an unrelated restaurant grant', async () => {
    const { d } = fixture;
    const { assignment } = await courierGrant();
    const owner = await authFor(d, 'owner@alrayez.test');
    const cashier = await authFor(d, 'cashier@alrayez.test');
    await code(removeCourierAssignment({ assignmentId: assignment.id, origin: 'PLATFORM', actor: { auth: owner } }), 'FORBIDDEN');
    await code(removeCourierAssignment({ assignmentId: assignment.id, origin: 'STORE', actor: { auth: cashier } }), 'FORBIDDEN');
    const foreignOwner = { ...owner, storePermissions: new Map([[crypto.randomUUID(), new Set(['staff.manage'])]]) };
    await code(removeCourierAssignment({ assignmentId: assignment.id, origin: 'STORE', actor: { auth: foreignOwner } }), 'FORBIDDEN');
    expect(await d.select().from(s.userRoles).where(eq(s.userRoles.id, assignment.id))).toHaveLength(1);
  });
});
