import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { estimateLine } from '@/client/cart';
import { customerMessage } from '@/components/customer/messages';
import { setupTestDb } from './helpers/db';
import { loadPublicMenu } from '@/server/services/menu';
import { createOrder, quote } from '@/server/services/checkout';
import { loadOrderSnapshots, loadTrackingView } from '@/server/services/order-views';
import { addons, deliveryPoints, products, productVariants } from '@/server/db/schema';

let fixture: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => { fixture = await setupTestDb(); });
afterAll(async () => { await fixture.client.close(); });

describe('bilingual customer content', () => {
  it('relocalizes a message already on screen after an offline language switch', () => {
    const ar = 'الاتصال مش مستقر. جرّب تحديث حساب الطلب.';
    const en = 'The connection is unstable. Try refreshing your order total.';
    expect(customerMessage(ar, 'en')).toBe(en);
    expect(customerMessage(en, 'ar')).toBe(ar);
    expect(customerMessage('رسالة كتبها العميل', 'en')).toBe('رسالة كتبها العميل');
  });

  it('exposes complete translated menu content and keeps cart prices unchanged between languages', async () => {
    const menu = (await loadPublicMenu(fixture.d, 'alrayez'))!;
    expect(menu.restaurant.badgeTextEn).toBe('Al Raya');
    expect(menu.restaurant.taglineEn).toContain('Damascus');
    expect(menu.banners.every((b) => b.titleEn && b.subtitleEn)).toBe(true);
    expect(menu.addonGroups[0].nameEn).toBe('Sandwich extras');
    const productId = fixture.demo.productIds['Chicken Shawarma Sandwich'];
    expect(menu.products.find((p) => p.id === productId)?.descriptionEn).toContain('garlic sauce');
    const line = { key: 'test', productId, variantId: fixture.demo.variantIds['Chicken Shawarma Sandwich:Regular'], addonIds: [fixture.demo.addonIds['Cheese']], quantity: 2 };
    const ar = estimateLine(menu, line, 'ar'), en = estimateLine(menu, line, 'en');
    expect(ar.name).toBe('ساندوتش شاورما فراخ');
    expect(en.name).toBe('Chicken Shawarma Sandwich');
    expect(en.detail).toBe('Regular • Cheese');
    expect(en.total).toBe(ar.total);
    expect(en.available).toBe(true);
  });

  it('returns English size and extras in server quotes', async () => {
    const result = await quote('alrayez', { items: [{ productId: fixture.demo.productIds['Chicken Shawarma Sandwich'], variantId: fixture.demo.variantIds['Chicken Shawarma Sandwich:Regular'], addonIds: [fixture.demo.addonIds['Cheese']], quantity: 1 }] });
    expect(result.lines[0].nameEn).toBe('Chicken Shawarma Sandwich');
    expect(result.lines[0].variantNameEn).toBe('Regular');
    expect(result.lines[0].addons[0].nameEn).toBe('Cheese');
  });

  it('freezes both languages in an order even after menu and pickup names are edited', async () => {
    const { d, demo } = fixture;
    const productId = demo.productIds['Chicken Shawarma Sandwich'];
    const variantId = demo.variantIds['Chicken Shawarma Sandwich:Regular'];
    const addonId = demo.addonIds['Cheese'];
    const result = await createOrder('alrayez', { items: [{ productId, variantId, addonIds: [addonId], quantity: 1 }], customerName: 'Sam', customerPhone: '01012345678', paymentMethod: 'CASH' }, 'bilingual-frozen-order');
    await d.update(products).set({ nameEn: 'New sandwich name' }).where(eq(products.id, productId));
    await d.update(productVariants).set({ nameEn: 'New size name' }).where(eq(productVariants.id, variantId));
    await d.update(addons).set({ nameEn: 'New cheese name' }).where(eq(addons.id, addonId));
    await d.update(deliveryPoints).set({ nameEn: 'New pickup point' }).where(eq(deliveryPoints.restaurantId, demo.restaurantId));
    const [snapshot] = await loadOrderSnapshots(d, [result.orderId], { includePhone: true });
    const tracking = (await loadTrackingView(d, result.trackingToken))!;
    for (const order of [snapshot, tracking.order]) {
      expect(order.deliveryPointNameEn).toBe('University Parking Gate');
      expect(order.items[0].nameEn).toBe('Chicken Shawarma Sandwich');
      expect(order.items[0].variantNameEn).toBe('Regular');
      expect(order.items[0].addons[0].nameEn).toBe('Cheese');
    }
  });
});
