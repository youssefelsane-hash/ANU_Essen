import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantEngine } from '@/client/merchant/engine';
import { receiptText } from '@/lib/receipt-text';
import type { Locale } from '@/lib/i18n';
import type { OrderSnapshot } from '@/lib/types';
import type { OutboxEntry } from '@/client/merchant/local-db';

const disk = vi.hoisted(() => ({ orders: [] as unknown[], outbox: [] as unknown[], meta: new Map<string, unknown>(), write: null as null | ((entry: unknown) => Promise<void>), readWait: null as null | (() => Promise<void>) }));
vi.mock('@/client/merchant/local-db', () => ({
  openLocalDb: async () => ({
    getAll: async () => { if (disk.readWait) await disk.readWait(); return structuredClone(disk.orders); },
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
  disk.orders = [order()]; disk.outbox = []; disk.meta.clear(); disk.write = null; disk.readWait = null;
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
  it('does not attach listeners or fetch after cleanup stops an instance during its initial database read', async () => {
    let finishRead!: () => void;
    disk.readWait = () => new Promise((resolve) => { finishRead = resolve; });
    const addWindowListener = vi.fn();
    const addDocumentListener = vi.fn();
    vi.stubGlobal('window', { addEventListener: addWindowListener, removeEventListener() {} });
    vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: addDocumentListener, removeEventListener() {} });
    const old = new MerchantEngine('store-1', 'user-1', new Set(['orders.kitchen']), () => {});
    running.push(old);
    const starting = old.start();
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'));
    old.stop();
    finishRead();
    await starting;
    expect(old.getState().ready).toBe(false);
    expect(addWindowListener).not.toHaveBeenCalled();
    expect(addDocumentListener).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    disk.readWait = null;
    const replacement = await start(['orders.kitchen']);
    expect(replacement.getState().ready).toBe(true);
    expect(addWindowListener).toHaveBeenCalled();
  });

  it.each([['orders.kitchen'], ['orders.view']])('alerts %j about a new automatically confirmed cash order without marking it ready', async (permission) => {
    disk.orders = [];
    const incoming = order({ status: 'CONFIRMED', confirmedAt: Date.now(), createdAt: Date.now() });
    const onAlert = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ viewerUserId: 'user-1', serverTime: Date.now(), cursor: 1, hasMore: false, reset: true, orders: [incoming], removed: [], store: null })));
    const engine = new MerchantEngine('store-1', 'user-1', new Set([permission]), onAlert);
    running.push(engine);
    await engine.start();
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(engine.getState().connectivity).toBe('online'));
    expect(onAlert.mock.calls[0][0][0].orderNumber).toBe('A100');
    expect(engine.getState().highlighted['order-1']).toBeDefined();
    expect(engine.getState().orders[0].status).toBe('CONFIRMED');
    expect(disk.outbox).toEqual([]);
    await engine.syncNow();
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it('lets the kitchen mark an automatically confirmed order ready in one durable offline action', async () => {
    disk.orders = [order({ status: 'CONFIRMED' })];
    const engine = await start(['orders.kitchen']);
    expect(await engine.dispatch('order-1', 'MARK_READY')).toBe(true);
    expect(engine.getState().orders[0].status).toBe('READY');
    expect((disk.outbox as OutboxEntry[]).map((entry) => entry.action)).toEqual(['MARK_READY']);
    expect(engine.getState().orders[0].preparingAt).toBeNull();
  });

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

  it('clears revoked restaurant orders and blocks new offline actions after a server 403', async () => {
    const engine = await start();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })));
    await engine.syncNow();
    await vi.waitFor(() => expect(engine.getState().accessDenied).toBe(true));
    expect(engine.getState().orders).toEqual([]);
    expect(disk.orders).toEqual([]);
    expect(disk.meta.get('cursor')).toBe(0);
    expect(await engine.dispatch('order-1', 'ACCEPT')).toBe(false);
  });

  it('hides cached customer details after a positive 401 while preserving saved actions for reauthentication', async () => {
    disk.orders = [order({ customerPhone: '01012345678' })];
    const engine = await start();
    expect(await engine.dispatch('order-1', 'ACCEPT')).toBe(true);
    const saved = structuredClone(disk.outbox as OutboxEntry[]);
    await vi.waitFor(() => expect(engine.getState().connectivity).toBe('offline'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })));
    await engine.syncNow();
    await vi.waitFor(() => expect(engine.getState().authError).toBe(true));
    expect(engine.getState().accessDenied).toBe(false);
    expect(engine.getState().orders).toEqual([]);
    expect(engine.getState().highlighted).toEqual({});
    expect(disk.orders).toEqual([]);
    expect(disk.meta.get('cursor')).toBe(0);
    expect(disk.outbox).toEqual(saved);
    expect(await engine.dispatch('order-1', 'MARK_READY')).toBe(false);

    const confirmed = order({ status: 'CONFIRMED', customerPhone: '01012345678' });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? Response.json({ viewerUserId: 'user-1', serverTime: Date.now(), results: saved.map((entry) => ({ eventId: entry.eventId, result: 'duplicate' })) })
      : Response.json({ viewerUserId: 'user-1', serverTime: Date.now(), cursor: 1, hasMore: false, reset: true, orders: [confirmed], removed: [], store: null })));
    await engine.syncNow();
    await vi.waitFor(() => expect(engine.getState().authError).toBe(false));
    expect(disk.outbox).toEqual([]);
    expect(engine.getState().orders[0].customerPhone).toBe('01012345678');
    expect(engine.getState().orders[0].status).toBe('CONFIRMED');
  });

  it('does not write new actions after the screen has stopped', async () => {
    const engine = await start();
    engine.stop();
    expect(await engine.dispatch('order-1', 'ACCEPT')).toBe(false);
    expect(disk.outbox).toEqual([]);
  });

  it('binds sync and durable action requests to the account that owns this screen', async () => {
    const engine = await start();
    await engine.dispatch('order-1', 'ACCEPT');
    await vi.waitFor(() => expect(engine.getState().connectivity).toBe('offline'));
    const saved = structuredClone(disk.outbox as OutboxEntry[]);
    const fetcher = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        expect(JSON.parse(init.body as string).actorUserId).toBe('user-1');
        return Response.json({ viewerUserId: 'user-1', serverTime: Date.now(), results: saved.map((entry) => ({ eventId: entry.eventId, result: 'duplicate' })) });
      }
      expect(new URL(url, 'http://localhost').searchParams.get('actorUserId')).toBe('user-1');
      return Response.json({ viewerUserId: 'user-1', serverTime: Date.now(), cursor: 1, hasMore: false, reset: true, orders: [order({ status: 'CONFIRMED' })], removed: [], store: null });
    });
    vi.stubGlobal('fetch', fetcher);
    await engine.syncNow();
    await vi.waitFor(() => expect(engine.getState().connectivity).toBe('synced'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(disk.outbox).toEqual([]);
  });

  it('never caches another account’s sync response in this account’s database', async () => {
    const engine = await start();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ viewerUserId: 'other-user', serverTime: Date.now(), cursor: 99, hasMore: false, reset: true, orders: [order({ customerPhone: '01099999999' })], removed: [], store: null })));
    await engine.syncNow();
    await vi.waitFor(() => expect(engine.getState().authError).toBe(true));
    expect(engine.getState().orders).toEqual([]);
    expect(disk.orders).toEqual([]);
    expect(disk.meta.get('cursor')).toBe(0);
  });

  it('preserves the exact durable outbox when an acknowledgement belongs to another account', async () => {
    const engine = await start();
    await engine.dispatch('order-1', 'ACCEPT');
    await vi.waitFor(() => expect(engine.getState().connectivity).toBe('offline'));
    const saved = structuredClone(disk.outbox as OutboxEntry[]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ viewerUserId: 'other-user', serverTime: Date.now(), results: saved.map((entry) => ({ eventId: entry.eventId, result: 'applied' })) })));
    await engine.syncNow();
    await vi.waitFor(() => expect(engine.getState().authError).toBe(true));
    expect(disk.outbox).toEqual(saved);
    expect(engine.getState().orders).toEqual([]);
    expect(await engine.dispatch('order-1', 'MARK_READY')).toBe(false);
  });

  it('uses the latest selected language when an offline action is rejected during replay', async () => {
    let locale: Locale = 'ar';
    const engine = await start(['orders.accept'], () => locale);
    await engine.dispatch('order-1', 'ACCEPT');
    await vi.waitFor(() => expect(engine.getState().connectivity).toBe('offline'));
    locale = 'en';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ viewerUserId: 'user-1', serverTime: Date.now(), results: (disk.outbox as OutboxEntry[]).map((entry) => ({ eventId: entry.eventId, result: 'rejected', code: 'INVALID_TRANSITION' })) });
      return Response.json({ viewerUserId: 'user-1', serverTime: Date.now(), cursor: 1, hasMore: false, reset: true, orders: [order({ status: 'CANCELLED', cancelledAt: Date.now() })], removed: [], store: null });
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
