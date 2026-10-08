import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialActionState } from '@/lib/action-state';
import { hasPermission, SYSTEM_ROLES } from '@/lib/domain/permissions';
import { updateMerchantBrandAction } from '@/server/actions/merchant-brand';
import { updateRestaurantBrand } from '@/server/services/restaurant-brand';
import { loadPublicMenu } from '@/server/services/menu';
import { POST as upload } from '@/app/api/merchant/media/route';
import { AppError } from '@/server/errors';
import * as s from '@/server/db/schema';
import { assignRole, bootstrapRestaurant, ensureUser } from '@/server/seed';
import { authFor, setupTestDb, TEST_PASSWORD } from './helpers/db';

const requestCookies = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (key: string) => requestCookies.has(key) ? { value: requestCookies.get(key) } : undefined, set: (key: string, value: string) => requestCookies.set(key, value) }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: () => {} }));

let fixture: Awaited<ReturnType<typeof setupTestDb>>;
let owner: Awaited<ReturnType<typeof authFor>>;
let otherRestaurantId: string;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const brand = (patch: Record<string, unknown> = {}) => ({ nameAr: 'مطعم جديد', nameEn: 'New restaurant', badgeText: 'جديد', badgeTextEn: 'New', taglineAr: 'أكل من القلب', taglineEn: 'Food from the heart', brandColor: '#243a63', logoUrl: null, coverImageUrl: '/images/restaurant-hero.webp', ...patch });
const forbidden = (error: unknown) => error instanceof AppError && error.code === 'FORBIDDEN';

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://unused:unused@localhost/unused');
  vi.stubEnv('LOG_LEVEL', 'error');
  fixture = await setupTestDb();
  owner = await authFor(fixture.d, 'owner@alrayez.test');
  await fixture.d.insert(s.sessions).values({ id: createHash('sha256').update('brand-owner-session').digest('hex'), userId: owner.user.id, expiresAt: new Date(Date.now() + 86_400_000) });
  const other = await bootstrapRestaurant(fixture.d, { slug: 'brand-other', nameAr: 'مطعم آخر', nameEn: 'Another restaurant' });
  otherRestaurantId = other.id;
});
beforeEach(() => { requestCookies.set('sid', 'brand-owner-session'); });
afterAll(async () => { await fixture.client.close(); vi.unstubAllEnvs(); });

function form(restaurantId: string, patch: Record<string, unknown> = {}) {
  const fd = new FormData();
  fd.set('restaurantId', restaurantId);
  for (const [key, value] of Object.entries(brand(patch))) fd.set(key, value === null ? '' : String(value));
  return fd;
}
async function uploadPhoto(restaurantId: string, scope = 'profile', options: { type?: string; data?: Uint8Array; origin?: string } = {}) {
  const response = await upload(new Request(`http://localhost/api/merchant/media?restaurantId=${restaurantId}&scope=${scope}`, {
    method: 'POST', headers: { host: 'localhost', origin: options.origin ?? 'http://localhost', 'content-type': options.type ?? 'image/png' }, body: new Uint8Array(options.data ?? png),
  }), undefined);
  return { status: response.status, data: await response.json() };
}

describe('restaurant self-service appearance', () => {
  it('gives brand editing to owner and manager while keeping cashiers and kitchen staff outside it', async () => {
    expect(hasPermission(owner, 'store.profile', fixture.demo.restaurantId)).toBe(true);
    const manager = await ensureUser(fixture.d, { email: 'brand-manager@test.local', name: 'Manager', password: TEST_PASSWORD });
    await assignRole(fixture.d, manager.id, 'MERCHANT_MANAGER', fixture.demo.restaurantId);
    expect(hasPermission(await authFor(fixture.d, manager.email), 'store.profile', fixture.demo.restaurantId)).toBe(true);
    for (const email of ['cashier@alrayez.test', 'kitchen@alrayez.test', 'delivery@alrayez.test']) {
      const auth = await authFor(fixture.d, email);
      await expect(updateRestaurantBrand(auth, fixture.demo.restaurantId, brand())).rejects.toSatisfy(forbidden);
    }
    const admin = SYSTEM_ROLES.find((role) => role.key === 'SUPER_ADMIN')!;
    expect(admin.permissions).toContain('store.profile');
  });

  it('updates only the owner’s restaurant and leaves platform controls and the QR/menu link unchanged', async () => {
    const [before] = await fixture.d.select().from(s.restaurants).where(eq(s.restaurants.id, fixture.demo.restaurantId));
    const result = await updateRestaurantBrand(owner, fixture.demo.restaurantId, brand({ commissionBps: 9999, isActive: false, orderingStatus: 'CLOSED', slug: 'stolen-menu', requirePhone: false }));
    const [after] = await fixture.d.select().from(s.restaurants).where(eq(s.restaurants.id, fixture.demo.restaurantId));
    expect(after).toMatchObject({ ...brand(), commissionBps: before.commissionBps, isActive: before.isActive, orderingStatus: before.orderingStatus, slug: before.slug, requirePhone: before.requirePhone });
    expect(result.slug).toBe(before.slug);
    expect(after.version).toBe(before.version + 1);
    const menu = (await loadPublicMenu(fixture.d, before.slug))!;
    expect(menu.restaurant).toMatchObject({ nameAr: 'مطعم جديد', nameEn: 'New restaurant', brandColor: '#243a63' });
    const [event] = await fixture.d.select().from(s.auditLogs).where(and(eq(s.auditLogs.restaurantId, before.id), eq(s.auditLogs.action, 'restaurant.brand_updated')));
    expect(event.actorUserId).toBe(owner.user.id);
    expect(event.after).not.toHaveProperty('commissionBps');
    const [foreignBefore] = await fixture.d.select().from(s.restaurants).where(eq(s.restaurants.id, otherRestaurantId));
    await expect(updateRestaurantBrand(owner, otherRestaurantId, brand())).rejects.toSatisfy(forbidden);
    const [foreignAfter] = await fixture.d.select().from(s.restaurants).where(eq(s.restaurants.id, otherRestaurantId));
    expect(foreignAfter).toEqual(foreignBefore);
  });

  it('checks authorization inside the action, including anonymous and blocked sessions', async () => {
    expect((await updateMerchantBrandAction(initialActionState, form(otherRestaurantId))).ok).toBe(false);
    requestCookies.delete('sid');
    expect((await updateMerchantBrandAction(initialActionState, form(fixture.demo.restaurantId))).ok).toBe(false);
    requestCookies.set('sid', 'brand-owner-session');
    await fixture.d.update(s.users).set({ isActive: false }).where(eq(s.users.id, owner.user.id));
    try { expect((await updateMerchantBrandAction(initialActionState, form(fixture.demo.restaurantId))).ok).toBe(false); }
    finally { await fixture.d.update(s.users).set({ isActive: true }).where(eq(s.users.id, owner.user.id)); }
  });

  it('rejects unsafe URLs and protected routes before any branding or audit changes', async () => {
    const [before] = await fixture.d.select().from(s.restaurants).where(eq(s.restaurants.id, fixture.demo.restaurantId));
    const previousEvents = await fixture.d.select().from(s.auditLogs).where(eq(s.auditLogs.action, 'restaurant.brand_updated'));
    for (const logoUrl of ['javascript:alert(1)', '//evil.example/logo.svg', '/api/merchant/orders/private/attachment', 'data:image/svg+xml,<svg/>']) {
      await expect(updateRestaurantBrand(owner, before.id, brand({ logoUrl }))).rejects.toBeDefined();
    }
    const [after] = await fixture.d.select().from(s.restaurants).where(eq(s.restaurants.id, before.id));
    expect(after).toEqual(before);
    expect(await fixture.d.select().from(s.auditLogs).where(eq(s.auditLogs.action, 'restaurant.brand_updated'))).toHaveLength(previousEvents.length);
  });

  it('accepts owned uploads and rejects another restaurant’s media, even through an absolute or encoded URL', async () => {
    const own = await uploadPhoto(fixture.demo.restaurantId);
    expect(own.status).toBe(201);
    await updateRestaurantBrand(owner, fixture.demo.restaurantId, brand({ logoUrl: own.data.url }));
    const [foreign] = await fixture.d.insert(s.media).values({ restaurantId: otherRestaurantId, contentType: 'image/png', data: png, sizeBytes: png.length }).returning();
    for (const logoUrl of [`/media/${foreign.id}`, `https://orders.example/media/${foreign.id}`, `/m%65dia/${foreign.id}`]) {
      await expect(updateRestaurantBrand(owner, fixture.demo.restaurantId, brand({ logoUrl }))).rejects.toSatisfy(forbidden);
    }
  });

  it('uses independent upload permissions and prevents foreign-store uploads and invalid image bodies', async () => {
    const editor = await ensureUser(fixture.d, { email: 'brand-only@test.local', name: 'Brand editor', password: TEST_PASSWORD });
    const [role] = await fixture.d.insert(s.roles).values({ key: 'BRAND_ONLY', name: 'Brand only', scope: 'STORE' }).returning();
    await fixture.d.insert(s.rolePermissions).values({ roleId: role.id, permissionKey: 'store.profile' });
    await fixture.d.insert(s.userRoles).values({ roleId: role.id, userId: editor.id, restaurantId: fixture.demo.restaurantId });
    await fixture.d.insert(s.sessions).values({ id: createHash('sha256').update('brand-only-session').digest('hex'), userId: editor.id, expiresAt: new Date(Date.now() + 86_400_000) });
    requestCookies.set('sid', 'brand-only-session');
    expect((await uploadPhoto(fixture.demo.restaurantId)).status).toBe(201);
    expect((await uploadPhoto(fixture.demo.restaurantId, 'menu')).status).toBe(403);
    expect((await uploadPhoto(otherRestaurantId)).status).toBe(403);
    expect((await uploadPhoto(fixture.demo.restaurantId, 'profile', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await uploadPhoto(fixture.demo.restaurantId, 'profile', { type: 'image/svg+xml' })).status).toBe(400);
    expect((await uploadPhoto(fixture.demo.restaurantId, 'profile', { data: new Uint8Array([1, 2, 3]) })).status).toBe(400);
    expect((await uploadPhoto(fixture.demo.restaurantId, 'profile', { data: new Uint8Array(600_001) })).status).toBe(413);
  });
});
