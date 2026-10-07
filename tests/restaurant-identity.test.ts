import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import type { PGlite } from '@electric-sql/pglite';
import type { Db } from '@/server/db';
import { GET as qrRedirect } from '@/app/q/[id]/route';
import { DEFAULT_BRAND_COLOR, brandTextColor, restaurantBrandSchema } from '@/lib/domain/restaurant-brand';
import { buildRestaurantQrUrl, publicOrigin, RESTAURANT_QR_OPTIONS } from '@/lib/domain/restaurant-qr';
import { hasPermission } from '@/lib/domain/permissions';
import { bootstrapRestaurant } from '@/server/seed';
import { restaurants, queueConfigs, storeCounters, restaurantPaymentMethods } from '@/server/db/schema';
import { loadPublicMenu } from '@/server/services/menu';
import { authFor, setupTestDb } from './helpers/db';

const ID = '7b0c6e1e-58a4-4f0b-9a52-3f0c1f2b9d11';

describe('restaurant identity validation', () => {
  it('trims names, defaults the color, accepts local image assets and normalizes blank branding', () => {
    const parsed = restaurantBrandSchema.parse({ nameAr: '  الراية الدمشقية  ', nameEn: ' Al Raya ', badgeText: ' ', coverImageUrl: '/images/restaurant-hero.webp' });
    expect(parsed.nameAr).toBe('الراية الدمشقية');
    expect(parsed.nameEn).toBe('Al Raya');
    expect(parsed.brandColor).toBe(DEFAULT_BRAND_COLOR);
    expect(parsed.badgeText).toBeNull();
    expect(parsed.logoUrl).toBeNull();
    expect(parsed.coverImageUrl).toBe('/images/restaurant-hero.webp');
  });

  it('rejects blank names, scripts, malformed colors and long badges', () => {
    const base = { nameAr: 'مطعم', nameEn: 'Restaurant' };
    for (const patch of [{ nameAr: '  ' }, { logoUrl: 'javascript:alert(1)' }, { coverImageUrl: '//untrusted.example/image.jpg' }, { brandColor: 'red' }, { badgeText: 'a'.repeat(25) }]) {
      expect(restaurantBrandSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
    expect(brandTextColor('#ffffff')).toBe('#111111');
    expect(brandTextColor(DEFAULT_BRAND_COLOR)).toBe('#ffffff');
  });
});

describe('permanent QR URLs', () => {
  it('builds a canonical ID link and preserves a distinct poster label', () => {
    expect(buildRestaurantQrUrl(' https://orders.example.com/ ', ID, 'gate_1')).toBe(`https://orders.example.com/q/${ID}?utm_source=gate_1`);
    expect(buildRestaurantQrUrl('https://orders.example.com', ID)).toBe(`https://orders.example.com/q/${ID}`);
  });

  it('refuses malformed origins and source labels before QR generation', () => {
    for (const origin of ['', 'orders.example.com', 'javascript:alert(1)', 'https://user:password@example.com', 'https://example.com/menu', 'https://example.com/?next=anything', 'https://example.com/#menu']) expect(() => publicOrigin(origin)).toThrow();
    expect(() => buildRestaurantQrUrl('https://example.com', 'bad-id')).toThrow();
    expect(() => buildRestaurantQrUrl('https://example.com', ID, 'gate 1')).toThrow();
    expect(() => buildRestaurantQrUrl('https://example.com', ID, 'a'.repeat(65))).toThrow();
  });

  it.each([
    ['https://orders.example.com', 'campus_poster_1'],
    ['http://localhost:3000', ''],
    [`https://campus-orders-${'a'.repeat(45)}.${'b'.repeat(63)}.example.com`, 'university_gate_building_04_noticeboard_poster_012345678901234567890'],
  ])('encodes and independently decodes a real QR matrix for %s', (origin, source) => {
    const url = buildRestaurantQrUrl(origin, ID, source.slice(0, 64));
    const { modules } = QRCode.create(url, RESTAURANT_QR_OPTIONS);
    const scale = 4;
    const quietZone = RESTAURANT_QR_OPTIONS.margin;
    const width = (modules.size + quietZone * 2) * scale;
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    for (let row = 0; row < modules.size; row++) {
      for (let column = 0; column < modules.size; column++) {
        if (!modules.get(row, column)) continue;
        for (let y = 0; y < scale; y++) {
          for (let x = 0; x < scale; x++) {
            const offset = (((row + quietZone) * scale + y) * width + (column + quietZone) * scale + x) * 4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
          }
        }
      }
    }
    const decoded = jsQR(pixels, width, width, { inversionAttempts: 'dontInvert' });
    expect(decoded?.data).toBe(url);
    expect(new URL(decoded!.data).pathname).toBe(`/q/${ID}`);
    expect(new URL(decoded!.data).searchParams.get('utm_source')).toBe(source.slice(0, 64) || null);
  });
});

let d: Db;
let client: PGlite;
let restaurantId: string;
beforeAll(async () => {
  const setup = await setupTestDb();
  d = setup.d;
  client = setup.client;
  restaurantId = setup.demo.restaurantId;
});
afterAll(async () => { await client?.close(); });

describe('restaurant isolation and QR routing', () => {
  it('creates a separate brand with independent queue, counters and payment methods', async () => {
    const other = await bootstrapRestaurant(d, { slug: 'second-restaurant', nameAr: 'المطعم التاني', nameEn: 'Second Restaurant', badgeText: 'Second', brandColor: '#935031', taglineAr: 'الطعم المميز' });
    const menu = (await loadPublicMenu(d, other.slug))!;
    expect(menu.restaurant.nameAr).toBe('المطعم التاني');
    expect(menu.restaurant.badgeText).toBe('Second');
    expect(menu.restaurant.brandColor).toBe('#935031');
    expect(menu.restaurant.coverImageUrl).toBeNull();
    expect(menu.products).toHaveLength(0);
    expect(menu.banners).toHaveLength(0);
    expect(menu.paymentMethods).toEqual([{ method: 'CASH' }]);
    expect(await d.select().from(queueConfigs).where(eq(queueConfigs.restaurantId, other.id))).toHaveLength(1);
    expect(await d.select().from(storeCounters).where(eq(storeCounters.restaurantId, other.id))).toHaveLength(1);
    expect(await d.select().from(restaurantPaymentMethods).where(eq(restaurantPaymentMethods.restaurantId, other.id))).toHaveLength(2);
    const first = (await loadPublicMenu(d, 'alrayez'))!;
    expect(first.restaurant.nameAr).toBe('الراية الدمشقية');
    expect(first.restaurant.badgeText).toBe('الراية');
    expect(first.restaurant.brandColor).toBe(DEFAULT_BRAND_COLOR);
  });

  it('reserves restaurant branding permissions for the platform admin', async () => {
    const owner = await authFor(d, 'owner@alrayez.test');
    const admin = await authFor(d, 'admin@test.local');
    expect(hasPermission(owner, 'platform.restaurants', restaurantId)).toBe(false);
    expect(hasPermission(admin, 'platform.restaurants', restaurantId)).toBe(true);
  });

  it('keeps the same printed QR working after a restaurant name and slug change', async () => {
    const url = buildRestaurantQrUrl('https://orders.example.com', restaurantId, 'table_04');
    const request = new NextRequest(url);
    const first = await qrRedirect(request, { params: Promise.resolve({ id: restaurantId }) });
    expect(first.status).toBe(307);
    expect(first.headers.get('location')).toBe('https://orders.example.com/s/alrayez?utm_source=table_04');
    await d.update(restaurants).set({ slug: 'new-raya-menu', nameAr: 'الاسم الجديد' }).where(eq(restaurants.id, restaurantId));
    const renamed = await qrRedirect(request, { params: Promise.resolve({ id: restaurantId }) });
    expect(renamed.headers.get('location')).toBe('https://orders.example.com/s/new-raya-menu?utm_source=table_04');
    expect(renamed.headers.get('cache-control')).toBe('no-store');
    expect((await loadPublicMenu(d, 'new-raya-menu'))!.restaurant.nameAr).toBe('الاسم الجديد');
  });

  it('rejects invalid IDs, keeps suspended stores reachable with a clear status, and drops untrusted tracking values', async () => {
    expect((await qrRedirect(new NextRequest('https://orders.example.com/q/bad'), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(404);
    const invalidTracking = await qrRedirect(new NextRequest(`https://orders.example.com/q/${restaurantId}?utm_source=bad%20label&next=https://evil.example`), { params: Promise.resolve({ id: restaurantId }) });
    expect(invalidTracking.headers.get('location')).toBe('https://orders.example.com/s/new-raya-menu');
    await d.update(restaurants).set({ isActive: false }).where(eq(restaurants.id, restaurantId));
    // Printed QR codes keep working while the platform suspends a restaurant: the menu explains it instead of a 404.
    expect((await qrRedirect(new NextRequest(`https://orders.example.com/q/${restaurantId}`), { params: Promise.resolve({ id: restaurantId }) })).status).toBe(307);
    const suspended = await loadPublicMenu(d, 'new-raya-menu');
    expect(suspended?.store).toMatchObject({ status: 'CLOSED', reason: 'INACTIVE' });
  });
});
