import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initialActionState } from '@/lib/action-state';
import { resetStaffPasswordAction } from '@/server/actions/merchant';
import { sessions, users } from '@/server/db/schema';
import { verifyPassword } from '@/server/auth/password';
import { assignRole } from '@/server/seed';
import { authFor, setupTestDb, TEST_PASSWORD } from './helpers/db';

const requestCookies = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (key: string) => requestCookies.has(key) ? { value: requestCookies.get(key) } : undefined, set: (key: string, value: string) => requestCookies.set(key, value) }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: () => {} }));

let fixture: Awaited<ReturnType<typeof setupTestDb>>;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://unused:unused@localhost/unused');
  fixture = await setupTestDb();
  const owner = await authFor(fixture.d, 'owner@alrayez.test');
  await fixture.d.insert(sessions).values({ id: tokenHash('owner-session'), userId: owner.user.id, expiresAt: new Date(Date.now() + 86_400_000) });
  requestCookies.set('sid', 'owner-session');
});
afterAll(async () => { await fixture.client.close(); vi.unstubAllEnvs(); });

function passwordForm(userId: string, password: string) {
  const form = new FormData();
  form.set('restaurantId', fixture.demo.restaurantId);
  form.set('userId', userId);
  form.set('password', password);
  return form;
}

describe('staff password reset', () => {
  it('revokes every existing staff session while retaining other users’ sessions', async () => {
    const { d } = fixture;
    const cashier = await authFor(d, 'cashier@alrayez.test');
    await d.insert(sessions).values([
      { id: tokenHash('cashier-tablet'), userId: cashier.user.id, expiresAt: new Date(Date.now() + 86_400_000) },
      { id: tokenHash('cashier-phone'), userId: cashier.user.id, expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    const result = await resetStaffPasswordAction(initialActionState, passwordForm(cashier.user.id, 'replacement-password-123'));
    expect(result.ok).toBe(true);
    expect(await d.select().from(sessions).where(eq(sessions.userId, cashier.user.id))).toEqual([]);
    expect(await d.select().from(sessions).where(eq(sessions.id, tokenHash('owner-session')))).toHaveLength(1);
    const [changed] = await d.select().from(users).where(eq(users.id, cashier.user.id));
    expect(await verifyPassword('replacement-password-123', changed.passwordHash)).toBe(true);
    expect(await verifyPassword(TEST_PASSWORD, changed.passwordHash)).toBe(false);
  });

  it('does not change credentials or revoke sessions when staff also hold a platform job', async () => {
    const { d } = fixture;
    const kitchen = await authFor(d, 'kitchen@alrayez.test');
    await assignRole(d, kitchen.user.id, 'SUPER_ADMIN', null);
    await d.insert(sessions).values({ id: tokenHash('protected-session'), userId: kitchen.user.id, expiresAt: new Date(Date.now() + 86_400_000) });
    const result = await resetStaffPasswordAction(initialActionState, passwordForm(kitchen.user.id, 'forbidden-replacement-123'));
    expect(result.ok).toBe(false);
    expect(await d.select().from(sessions).where(eq(sessions.id, tokenHash('protected-session')))).toHaveLength(1);
    const [unchanged] = await d.select().from(users).where(eq(users.id, kitchen.user.id));
    expect(await verifyPassword(TEST_PASSWORD, unchanged.passwordHash)).toBe(true);
  });
});
