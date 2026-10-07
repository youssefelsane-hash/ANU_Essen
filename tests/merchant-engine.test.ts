import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantEngine } from '@/client/merchant/engine';
import { receiptText } from '@/lib/receipt-text';
import type { Locale } from '@/lib/i18n';
import type { OrderSnapshot } from '@/lib/types';
import type { OutboxEntry } from '@/client/merchant/local-db';

const disk = vi.hoisted(() => ({ orders: [] as unknown[], outbox: [] as unknown[], meta: new Map<string, unknown>(), write: null as null | ((entry: unknown) => Promise<void>) }));
vi.mock('@/client/merchant/local-db', () => ({
  openLocalDb: async () => ({
    getAll: async () => structuredClone(disk.orders),
    getAllFromIndex: async () => structuredClone(disk.outbox),
    get: async (_store: string, key: string) => disk.meta.get(key),
    put: async (store: string, entry: unknown, key?: string) => {
      if (store === 'outbox') {
        if (disk.write) await disk.write(entry);
        disk.outbox.push(entry);
      } else disk.meta.set(key!, entry);
    },
    delete: async (_store: string, key: string) => { disk.outbox = disk.outbox.filter((entry) => (entry as { eventId: string }).eventId !== key); },
    transaction: () => ({
      objectStore: (store: string) => store === 'orders' ? { clear: async () => { disk.orders = []; }, put: async (entry: unknown) => { disk.orders.push(entry); }, delete: async () => {} } : { put: async (entry: unknown, key: string) => { disk.meta.set(key, entry); } },
      done: Promise.resolve(),
    }),
    close: () => {},
  }),
  readMeta: async (_db: unknown, key: string, fallback: unknown) => disk.meta.get(key) ?? fallback,
}));

function order(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    id: 'order-1', restaurantId: 'store-1', orderNumber: 'A100', status: 'CREATED', paymentMethod: 'CASH', paymentStatus: 'CASH',
    paymentReference: null, paymentRejectedReason: null, hasPaymentAttachment: false, customerName: 'Sam', customerPhone: null, customerNote: null,
    deliveryPointName: 'بوابة الجامعة', deliveryPointNameEn: 'University Gate', fulfillment: 'DELIVERY', channel: 'ONLINE',
    items: [{ id: 'item-1', nameAr: 'شاورما', nameEn: 'Shawarma', variantNameAr: 'كبير', variantNameEn: 'Large', quantity: 1, unitPrice: 8500, addonsPerUnit: 500, lineTotal: 9000, addons: [{ nameAr: 'جبنة', nameEn: 'Cheese', price: 500 }], note: null }],
    subtotal: 9000, discountTotal: 0, deliveryFee: 0, total: 9000, currency: 'EGP', promoCode: null, loadUnits: 1,
    estimatedReadyAt: null, estimatedArrivalAt: null, createdAt: Date.now(), confirmedAt: null, preparingAt: null, readyAt: null,
    outForDeliveryAt: null, arrivedAt: null, completedAt: null, cancelledAt: null, cancelReason: null, assignedToUserId: null, assignedToName: null, timeline: [], version: 1,
    ...overrides,
  };
}

let running: MerchantEngine[] = [];
beforeEach(() => {
  disk.orders = [order()]; disk.outbox = []; disk.meta.clear(); disk.write = null;
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('localStorage', { getItem: () => 'test-device', setItem() {} });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
});
afterEach(() => { running.forEach((engine) => engine.stop()); running = []; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function start(permissions = ['orders.accept', 'orders.kitchen'], getLocale: () => Locale = () => 'ar') {
  const engine = new MerchantEngine('store-1', 'user-1', new Set(permissions), () => {}, getLocale);
  running.push(engine);
  await engine.start();
  await vi.waitFor(() => expect(engine.getState().connectivity).toBe('offline'));
  return engine;
}

describe('merchant outbox under real interaction timing', () => {
  it('records one action for repeated taps while the first disk write is still pending', async () => {
    const engine = await start();
    let completeWrite!: () => void;
    disk.write = () => new Promise((resolve) => { completeWrite = resolve; });
    const first = engine.dispatch('order-1', 'ACCEPT');
    expect(await engine.dispatch('order-1', 'ACCEPT')).toBe(false);
    expect(engine.getState().orders[0].status).toBe('CREATED'); // optimistic display waits for durable persistence
    completeWrite();
    expect(await first).toBe(true);
    expect(disk.outbox).toHaveLength(1);
    expect(engine.getState().orders[0].status).toBe('CONFIRMED');
    expect(engine.getState().pending['order-1']).toBe(1);
  });

  it('preserves the saved action sequence when taps share a millisecond and the device clock moves backward', async () => {
    const engine = await start();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    await engine.dispatch('order-1', 'ACCEPT');
    clock.mockReturnValue(999);
    await engine.dispatch('order-1', 'START_PREPARING');
    const saved = disk.outbox as OutboxEntry[];
    expect(saved.map((entry) => entry.action)).toEqual(['ACCEPT', 'START_PREPARING']);
    expect(saved[1].createdAt).toBeGreaterThan(saved[0].createdAt);
    expect(engine.getState().orders[0].status).toBe('PREPARING');
  });

  it('does not queue handover of another courier’s delivery from a stale offline screen', async () => {
    disk.orders = [order({ status: 'OUT_FOR_DELIVERY', assignedToUserId: 'other-courier' })];
    const courier = await start(['orders.delivery']);
    expect(await courier.dispatch('order-1', 'MARK_ARRIVED')).toBe(false);
    expect(await courier.dispatch('order-1', 'COMPLETE')).toBe(false);
    expect(disk.outbox).toEqual([]);
    expect(courier.getState().orders[0].status).toBe('OUT_FOR_DELIVERY');
  });

  it('keeps the original status after a disk failure and permits a successful retry', async () => {
    const engine = await start();
    disk.write = async () => { throw new Error('storage full'); };
    await expect(engine.dispatch('order-1', 'ACCEPT')).rejects.toThrow('storage full');
    expect(engine.getState().orders[0].status).toBe('CREATED');
    expect(engine.getState().outboxCount).toBe(0);
    disk.write = null;
    expect(await engine.dispatch('order-1', 'ACCEPT')).toBe(true);
    expect(engine.getState().orders[0].status).toBe('CONFIRMED');
  });

  it('does not write new actions after the screen has stopped', async () => {
    const engine = await start();
    engine.stop();
    expect(await engine.dispatch('order-1', 'ACCEPT')).toBe(false);
    expect(disk.outbox).toEqual([]);
  });

  it('uses the latest selected language when an offline action is rejected during replay', async () => {
    let locale: Locale = 'ar';
    const engine = await start(['orders.accept'], () => locale);
    await engine.dispatch('order-1', 'ACCEPT');
    await vi.waitFor(() => expect(engine.getState().connectivity).toBe('offline'));
    locale = 'en';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ serverTime: Date.now(), results: (disk.outbox as OutboxEntry[]).map((entry) => ({ eventId: entry.eventId, result: 'rejected', code: 'INVALID_TRANSITION' })) });
      return Response.json({ serverTime: Date.now(), cursor: 1, hasMore: false, reset: true, orders: [order({ status: 'CANCELLED', cancelledAt: Date.now() })], removed: [], store: null });
    }));
    await engine.syncNow();
    await vi.waitFor(() => expect(engine.getState().outboxCount).toBe(0));
    expect(engine.getState().notice).toContain('changed on another device');
    expect(engine.getState().orders[0].status).toBe('CANCELLED');
  });
});

describe('receipt language', () => {
  it('prints a fully English cash instruction, translated options and pickup point from the frozen order', () => {
    const receipt = receiptText(order(), 'Al Raya', 'Africa/Cairo', 42, 'en');
    expect(receipt).toContain('Shawarma (Large)');
    expect(receipt).toContain('+ Cheese');
    expect(receipt).toContain('University Gate');
    expect(receipt).toContain('COLLECT CASH');
    expect(receipt).toContain('90 EGP');
    expect(receipt).not.toMatch(/[\u0600-\u06ff]/);
  });
  it('prints Arabic payment labels and marks a paid order without a cash collection instruction', () => {
    const receipt = receiptText(order({ paymentStatus: 'PAYMENT_VERIFIED' }), 'الراية', 'Africa/Cairo', 32, 'ar');
    expect(receipt).toContain('شاورما (كبير)');
    expect(receipt).toContain('جبنة');
    expect(receipt).toContain('بوابة الجامعة');
    expect(receipt).toContain('مدفوع');
    expect(receipt).not.toContain('تحصيل كاش');
    expect(receipt).not.toContain('COLLECT CASH');
  });
});
