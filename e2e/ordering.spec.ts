import { test, expect, type Page, type BrowserContext, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import AxeBuilder from '@axe-core/playwright';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const slug = process.env.E2E_RESTAURANT_SLUG || 'alrayez';
test.skip(!adminPassword, 'Set E2E_ADMIN_PASSWORD for a local seeded demo database.');

async function screenshot(page: Page, name: string, info: TestInfo) {
  const destination = process.env.QA_OUTPUT_DIR ? path.join(process.env.QA_OUTPUT_DIR, name) : info.outputPath(name);
  await mkdir(path.dirname(destination), { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: destination, fullPage: true });
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(adminEmail);
  await page.getByLabel('كلمة المرور').fill(adminPassword!);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
}

async function transition(context: BrowserContext, restaurantId: string, orderId: string, action: string) {
  const res = await context.request.post('/api/merchant/actions', { data: {
    restaurantId, deviceId: randomUUID(), actions: [{ eventId: randomUUID(), orderId, action, occurredAt: Date.now() }],
  } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.results[0].result).toBe('applied');
}

test('mobile cash checkout, customization, discount and full order lifecycle', async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/s/${slug}`);
  await expect(page.getByRole('heading', { name: 'الراية الدمشقية', exact: true })).toBeVisible();
  await screenshot(page, 'menu-desktop.png', info);
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'menu-mobile.png', info);
  await accessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('textbox', { name: 'ابحث في المنيو' }).fill('شاورما فراخ');
  await expect(page.getByRole('button', { name: 'إضافة ساندوتش شاورما لحمة للسلة' })).toHaveCount(0);
  await page.getByRole('button', { name: 'تفاصيل ساندوتش شاورما فراخ' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await modal.getByRole('radio', { name: /كبير/ }).check();
  await modal.getByRole('checkbox', { name: /ثومية زيادة/ }).check();
  await modal.getByRole('button', { name: 'زيادة الكمية', exact: true }).click();
  await screenshot(page, 'product-options-mobile.png', info);
  await modal.getByRole('button', { name: /أضف للسلة/ }).click();
  await page.getByRole('link', { name: /مراجعة الطلب/ }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await page.getByLabel('اسمك', { exact: true }).fill('تجربة الطلب');
  await page.getByLabel(/رقم الموبايل/).fill('01012345678');
  await page.getByRole('radio', { name: /كاش عند الاستلام/ }).check();
  await page.getByRole('button', { name: 'عندك كود خصم؟' }).click();
  await page.getByRole('textbox', { name: 'كود الخصم' }).fill('WELCOME10');
  await page.getByRole('button', { name: 'تطبيق', exact: true }).click();
  await expect(page.locator('.checkout-grand-total')).toContainText('153');
  await screenshot(page, 'checkout-mobile.png', info);
  await accessible(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await screenshot(page, 'checkout-desktop.png', info);
  await page.getByRole('button', { name: /تأكيد الطلب/ }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByRole('heading', { name: 'في انتظار تأكيد المطعم' })).toBeVisible();
  const trackingURL = page.url();
  const token = trackingURL.split('/order/')[1];
  const data = await (await page.request.get(`/api/public/orders/${token}`)).json();
  expect(data.order.total).toBe(15300);
  expect(data.order.items[0].quantity).toBe(2);
  expect(data.order.estimatedArrivalAt).toBeGreaterThan(data.order.createdAt);
  const menu = await (await page.request.get(`/api/public/stores/${slug}`)).json();
  const staff = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const staffPage = await staff.newPage();
  await login(staffPage);
  await transition(staff, menu.restaurant.id, data.order.id, 'ACCEPT');
  await transition(staff, menu.restaurant.id, data.order.id, 'START_PREPARING');
  // A student's phone can be hours wrong. The countdown must still use server time.
  await page.addInitScript(() => {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + 6 * 3600_000;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'أكلك بيتحضّر' })).toBeVisible();
  const minutes = Number((await page.locator('.tracking-countdown').innerText()).split(':')[0]);
  expect(minutes).toBeGreaterThanOrEqual(0);
  expect(minutes).toBeLessThan(30);
  await screenshot(page, 'tracking-desktop.png', info);
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'tracking-mobile.png', info);
  await accessible(page);
  for (const action of ['MARK_READY', 'OUT_FOR_DELIVERY', 'MARK_ARRIVED', 'COMPLETE']) await transition(staff, menu.restaurant.id, data.order.id, action);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'تم التسليم. بالهنا والشفا!' })).toBeVisible();
  expect(errors).toEqual([]);
  await staff.close();
});

test('InstaPay submission and reviewed payment advances to confirmed', async ({ page, browser }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/s/${slug}`);
  await page.getByRole('button', { name: 'إضافة وجبة شاورما للسلة' }).click();
  await page.getByRole('link', { name: /مراجعة الطلب/ }).filter({ visible: true }).click();
  await page.getByLabel('اسمك', { exact: true }).fill('تجربة التحويل');
  await page.getByLabel(/رقم الموبايل/).fill('01012345679');
  await page.getByRole('radio', { name: /InstaPay/ }).check();
  const confirm = page.getByRole('button', { name: /تأكيد الطلب/ }).filter({ visible: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByRole('heading', { name: 'كمّل الدفع بـ InstaPay' })).toBeVisible();
  await screenshot(page, 'instapay-mobile.png', info);
  await page.getByLabel('رقم العملية (اختياري)').fill('LOCAL-QA-TRANSFER');
  await page.getByRole('button', { name: 'تم التحويل ✓' }).click();
  await expect(page.getByRole('heading', { name: 'التحويل تحت المراجعة' })).toBeVisible();
  const token = page.url().split('/order/')[1];
  const data = await (await page.request.get(`/api/public/orders/${token}`)).json();
  const menu = await (await page.request.get(`/api/public/stores/${slug}`)).json();
  const staff = await browser.newContext({ baseURL: new URL(page.url()).origin });
  await login(await staff.newPage());
  await transition(staff, menu.restaurant.id, data.order.id, 'VERIFY_PAYMENT');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'المطعم أكد طلبك' })).toBeVisible();
  await staff.close();
});

test('admin QR and branded poster downloads independently decode to the correct restaurant', async ({ page }, info) => {
  const menu = await (await page.request.get(`/api/public/stores/${slug}`)).json();
  await login(page);
  await screenshot(page, 'admin-overview.png', info);
  await page.goto(`/admin/restaurants/${menu.restaurant.id}`);
  await screenshot(page, 'admin-branding.png', info);
  await page.goto(`/admin/restaurants/${menu.restaurant.id}/marketing`);
  await page.getByLabel(/Poster label/).fill('e2e_qr');
  await expect(page.getByRole('button', { name: 'QR PNG', exact: true })).toBeEnabled();
  await screenshot(page, 'admin-qr.png', info);
  for (const [name, button] of [['qr-demo.png', 'QR PNG'], ['qr-poster-demo.png', 'Download branded poster']]) {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const download = await event;
    const destination = process.env.QA_OUTPUT_DIR ? path.join(process.env.QA_OUTPUT_DIR, name) : info.outputPath(name);
    await download.saveAs(destination);
    const png = PNG.sync.read(await readFile(destination));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.data).toContain(`/q/${menu.restaurant.id}?utm_source=e2e_qr`);
    const res = await page.request.get(decoded!.data, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain(`/s/${slug}?utm_source=e2e_qr`);
  }
});
