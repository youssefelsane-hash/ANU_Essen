import { uuid } from '@/client/ids';
import { isTerminal, nextStatus, paymentStatusAfter, primaryActionFor, STATUS_TIMESTAMP_FIELD, transitionFor, type OrderAction } from '@/lib/domain/order-machine';
import type { ActionResult, OrderSnapshot, StoreLive, SyncResponse } from '@/lib/types';
import { errorMessage, text, type Locale } from '@/lib/i18n';
import { openLocalDb, readMeta, type LocalDb, type OutboxEntry } from './local-db';

export type Connectivity = 'online' | 'offline' | 'syncing' | 'synced';

export interface EngineState {
  ready: boolean;
  orders: OrderSnapshot[];
  pending: Record<string, number>;
  outboxCount: number;
  connectivity: Connectivity;
  lastSyncAt: number | null;
  store: StoreLive | null;
  serverOffset: number;
  authError: boolean;
  /** The server explicitly revoked this restaurant scope. */
  accessDenied?: boolean;
  notice: string | null;
  highlighted: Record<string, number>;
}

class NetworkError extends Error {}
class AuthError extends Error { constructor(readonly status: number) { super(status === 403 ? 'forbidden' : 'unauthenticated'); } }

const DEVICE_KEY = 'merchant:deviceId';
const POLL_MS = 3000;
const KEEP_TERMINAL_MS = 24 * 3600_000;

export function deviceId(scope = ''): string {
  const key = scope ? `${DEVICE_KEY}:${scope}` : DEVICE_KEY;
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = uuid();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    const memory = globalThis as { __merchantDeviceIds?: Record<string, string> };
    const ids = memory.__merchantDeviceIds ??= {};
    return ids[key] ??= uuid();
  }
}

async function request<T>(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new NetworkError('network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
  if (res.status >= 500 || res.status === 429) throw new NetworkError(`server ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`);
  return data as T;
}

/** Applies not-yet-acknowledged local actions on top of the server snapshot (optimistic offline state). */
export function applyPending(order: OrderSnapshot, pending: OutboxEntry[], actorUserId?: string): OrderSnapshot {
  let view = order;
  for (const p of pending) {
    const next = nextStatus(view.status, p.action, view.fulfillment ?? 'DELIVERY');
    if (!next) continue;
    const field = STATUS_TIMESTAMP_FIELD[next];
    view = { ...view, status: next, ...(field ? { [field]: p.occurredAt } : {}) };
    const paymentStatus = paymentStatusAfter(p.action, view.paymentMethod, view.paymentStatus);
    if (paymentStatus) view = { ...view, paymentStatus };
    if (p.action === 'CANCEL') view = { ...view, cancelReason: p.payload?.reason ?? null };
    if (p.action === 'OUT_FOR_DELIVERY' && actorUserId) view = { ...view, assignedToUserId: actorUserId };
  }
  return view;
}

/**
 * Offline-first merchant engine.
 * - Orders are written to IndexedDB (together with the sync cursor) before they appear on screen.
 * - Staff actions go to a durable outbox first, then sync with idempotent, UUID-keyed requests.
 * - Pull sync uses the server event cursor, so orders missed during an outage are fetched on reconnect.
 */
export class MerchantEngine {
  private db!: LocalDb;
  private server = new Map<string, OrderSnapshot>();
  private outbox: OutboxEntry[] = [];
  /** Acknowledged by the server but not yet reflected in a pulled snapshot — kept applied to avoid flicker. */
  private acked: OutboxEntry[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private syncAgain = false;
  private backoff = POLL_MS;
  private stopped = false;
  private cleanup: (() => void)[] = [];
  private dispatching = new Set<string>();
  private lastQueuedAt = 0;
  private state: EngineState = {
    ready: false,
    orders: [],
    pending: {},
    outboxCount: 0,
    connectivity: 'syncing',
    lastSyncAt: null,
    store: null,
    serverOffset: 0,
    authError: false,
    notice: null,
    highlighted: {},
  };

  constructor(
    private readonly restaurantId: string,
    private readonly userId: string,
    private readonly permissions: ReadonlySet<string>,
    private readonly onAlert: (orders: OrderSnapshot[]) => void,
    private readonly getLocale: () => Locale = () => 'ar',
    private readonly pollMs = POLL_MS,
  ) { this.backoff = pollMs; }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getState = () => this.state;

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  async start() {
    if (this.stopped) return;
    this.db = await openLocalDb(this.restaurantId, this.userId, this.permissions);
    if (this.stopped) {
      this.db.close();
      return;
    }
    const [orders, outbox, store, serverOffset, lastSyncAt] = await Promise.all([
      this.db.getAll('orders'),
      this.db.getAllFromIndex('outbox', 'byCreated'),
      readMeta(this.db, 'store', null),
      readMeta(this.db, 'serverOffset', 0),
      readMeta(this.db, 'lastSyncAt', null),
    ]);
    // A StrictMode cleanup or navigation can stop this instance while IndexedDB is reading.
    if (this.stopped) return;
    const now = Date.now();
    for (const o of orders) {
      const finishedAt = o.completedAt ?? o.cancelledAt;
      if (isTerminal(o.status) && finishedAt && now - finishedAt > KEEP_TERMINAL_MS && !outbox.some((x) => x.orderId === o.id)) {
        await this.db.delete('orders', o.id);
      } else {
        this.server.set(o.id, o);
      }
    }
    if (this.stopped) return;
    this.outbox = outbox;
    this.lastQueuedAt = outbox.reduce((latest, entry) => Math.max(latest, entry.createdAt), 0);
    this.set({ ready: true, store, serverOffset, lastSyncAt, connectivity: navigator.onLine ? 'syncing' : 'offline' });
    this.recompute();

    const onOnline = () => this.syncNow();
    const onOffline = () => this.set({ connectivity: 'offline' });
    const onVisible = () => document.visibilityState === 'visible' && this.syncNow();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    this.cleanup.push(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    });
    void this.syncNow();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.cleanup.forEach((c) => c());
    this.db?.close();
  }

  /** Records a staff action locally (durably) and syncs it when possible. Works fully offline. */
  async dispatch(orderId: string, action: OrderAction, payload?: { reason?: string }): Promise<boolean> {
    if (this.stopped || this.state.accessDenied || this.state.authError || !this.state.ready || this.dispatching.has(orderId)) return false;
    const current = this.state.orders.find((o) => o.id === orderId);
    const fulfillment = current?.fulfillment ?? 'DELIVERY';
    if (!current || !nextStatus(current.status, action, fulfillment)) return false;
    const def = transitionFor(action, fulfillment);
    if (!def || (!this.permissions.has(def.permission) && !this.permissions.has('*'))) return false;
    if (
      (action === 'MARK_ARRIVED' || action === 'COMPLETE') &&
      !this.permissions.has('orders.view') && !this.permissions.has('*') &&
      current.assignedToUserId && current.assignedToUserId !== this.userId
    ) return false;
    const createdAt = Math.max(Date.now(), this.lastQueuedAt + 1);
    this.lastQueuedAt = createdAt;
    const entry: OutboxEntry = {
      eventId: uuid(),
      orderId,
      action,
      occurredAt: Date.now() + this.state.serverOffset,
      payload,
      createdAt,
      attempts: 0,
    };
    // Ignore rapid repeated taps until the first action has been durably saved.
    this.dispatching.add(orderId);
    try {
      await this.db.put('outbox', entry); // persisted before the UI changes
      this.outbox.push(entry);
      this.recompute();
      void this.syncNow();
      return true;
    } finally {
      this.dispatching.delete(orderId);
    }
  }

  setStore(store: StoreLive) {
    this.set({ store });
    void this.db.put('meta', store, 'store');
  }

  clearNotice() {
    this.set({ notice: null });
  }

  async syncNow(): Promise<void> {
    if (this.stopped) return;
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    if (this.timer) clearTimeout(this.timer);
    let flushed = 0;
    try {
      if (this.outbox.length) {
        this.set({ connectivity: 'syncing' });
        flushed = await this.flush();
      }
      await this.pull();
      this.backoff = this.pollMs;
      this.set({ connectivity: flushed > 0 ? 'synced' : this.outbox.length ? 'syncing' : 'online', authError: false, lastSyncAt: Date.now() });
      void this.db.put('meta', Date.now(), 'lastSyncAt');
    } catch (err) {
      if (err instanceof AuthError) {
        // A positive denial (including a blocked/expired session's 401) hides cached customer data.
        // Preserve the durable outbox so signing back in can safely reconcile previously saved work.
        this.server.clear();
        this.acked = [];
        this.set({ accessDenied: err.status === 403, authError: true, orders: [], pending: {}, highlighted: {}, store: null, connectivity: 'offline' });
        try {
          const tx = this.db.transaction(['orders', 'meta'], 'readwrite');
          await tx.objectStore('orders').clear();
          await tx.objectStore('meta').put(0, 'cursor');
          await tx.done;
        } catch { /* Keep the revoked scope hidden even if this device cannot clear its disk cache. */ }
        finally { if (err.status === 403) this.stop(); }
      }
      else if (err instanceof NetworkError) this.set({ connectivity: 'offline' });
      else this.set({ notice: errorMessage('INTERNAL', this.getLocale(), (err as Error).message) });
      this.backoff = Math.min(this.backoff * 1.6, 15_000);
    } finally {
      this.syncing = false;
      if (!this.stopped) {
        if (this.syncAgain) {
          this.syncAgain = false;
          void this.syncNow();
        } else {
          const delay = this.state.connectivity === 'offline' ? this.backoff : document.visibilityState === 'visible' ? this.pollMs : 10_000;
          this.timer = setTimeout(() => void this.syncNow(), delay);
        }
      }
    }
  }

  private async flush(): Promise<number> {
    let done = 0;
    for (let round = 0; round < 5 && this.outbox.length; round++) {
      const batch = [...this.outbox].sort((a, b) => a.createdAt - b.createdAt).slice(0, 50);
      const res = await request<{ serverTime: number; results: ActionResult[]; viewerUserId: string }>('/api/merchant/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          restaurantId: this.restaurantId,
          actorUserId: this.userId,
          deviceId: deviceId(`${this.restaurantId}:${this.userId}`),
          actions: batch.map(({ eventId, orderId, action, occurredAt, payload }) => ({ eventId, orderId, action, occurredAt, payload })),
        }),
      });
      if (res.viewerUserId !== this.userId) throw new AuthError(401);
      let retry = false;
      const rejected: string[] = [];
      for (const r of res.results) {
        if (r.result === 'retry') {
          retry = true;
          const e = this.outbox.find((x) => x.eventId === r.eventId);
          if (e) await this.db.put('outbox', { ...e, attempts: e.attempts + 1, lastError: r.code ?? null });
          continue;
        }
        const entry = this.outbox.find((x) => x.eventId === r.eventId);
        if (r.result === 'rejected') rejected.push(r.message ?? r.code ?? 'rejected');
        else if (entry) this.acked.push(entry);
        await this.db.delete('outbox', r.eventId);
        this.outbox = this.outbox.filter((x) => x.eventId !== r.eventId);
        done++;
      }
      if (rejected.length) this.set({ notice: text(this.getLocale(), 'تم تجاهل إجراء لأن الطلب اتغيّر من جهاز تاني — الشاشة اتحدثت بحالة السيرفر.', 'This order changed on another device. The board now shows the latest saved status.') });
      this.recompute();
      if (retry) break;
    }
    return done;
  }

  private async pull() {
    let cursor = await readMeta(this.db, 'cursor', 0);
    const bootstrap = cursor === 0;
    const alerts: OrderSnapshot[] = [];
    for (let page = 0; page < 10; page++) {
      const started = Date.now();
      const res = await request<SyncResponse & { viewerUserId: string }>(
        `/api/merchant/sync?restaurantId=${this.restaurantId}&actorUserId=${encodeURIComponent(this.userId)}&deviceId=${deviceId(`${this.restaurantId}:${this.userId}`)}&cursor=${cursor}`,
      );
      if (res.viewerUserId !== this.userId) throw new AuthError(401);
      const serverOffset = Math.round(res.serverTime - (started + Date.now()) / 2);

      // Persist first (orders + cursor atomically), only then show them.
      const tx = this.db.transaction(['orders', 'meta'], 'readwrite');
      const ordersStore = tx.objectStore('orders');
      if (res.reset) await ordersStore.clear();
      for (const o of res.orders) await ordersStore.put(o);
      for (const id of res.removed) await ordersStore.delete(id);
      const meta = tx.objectStore('meta');
      await meta.put(res.cursor, 'cursor');
      await meta.put(res.store, 'store');
      await meta.put(serverOffset, 'serverOffset');
      await tx.done;

      if (res.reset) this.server.clear();
      const before = new Map(this.state.orders.map((o) => [o.id, o.status]));
      // Server snapshots now include everything acknowledged before this pull.
      this.acked = [];
      for (const o of res.orders) {
        const prevStatus = before.get(o.id);
        const fresh = !bootstrap || Date.now() + serverOffset - o.createdAt < 2 * 60_000;
        if (prevStatus !== o.status && fresh && this.isActionable(o)) alerts.push(o);
        this.server.set(o.id, o);
      }
      for (const id of res.removed) this.server.delete(id);
      this.set({ store: res.store, serverOffset });
      cursor = res.cursor;
      if (!res.hasMore) break;
    }
    this.recompute();
    if (alerts.length) {
      const highlighted = { ...this.state.highlighted };
      for (const o of alerts) highlighted[o.id] = Date.now();
      this.set({ highlighted });
      this.onAlert(alerts);
    }
  }

  private isActionable(o: OrderSnapshot): boolean {
    if (o.status === 'AWAITING_PAYMENT') return false; // nothing to do until the customer pays
    // Automatically confirmed cash orders must still notify the kitchen and cashier.
    if (o.status === 'CONFIRMED' && (this.permissions.has('orders.view') || this.permissions.has('orders.kitchen') || this.permissions.has('*'))) return true;
    const action = primaryActionFor(o.status, o.fulfillment ?? 'DELIVERY');
    const def = action ? transitionFor(action, o.fulfillment ?? 'DELIVERY') : null;
    return !!def && (this.permissions.has(def.permission) || this.permissions.has('*'));
  }

  private recompute() {
    const pending: Record<string, number> = {};
    const byOrder = new Map<string, OutboxEntry[]>();
    for (const e of [...this.acked, ...this.outbox].sort((a, b) => a.createdAt - b.createdAt)) {
      byOrder.set(e.orderId, [...(byOrder.get(e.orderId) ?? []), e]);
    }
    for (const e of this.outbox) pending[e.orderId] = (pending[e.orderId] ?? 0) + 1;
    const orders = [...this.server.values()]
      .map((o) => applyPending(o, byOrder.get(o.id) ?? [], this.userId))
      .sort((a, b) => a.createdAt - b.createdAt);
    this.set({ orders, pending, outboxCount: this.outbox.length });
  }

  unhighlight(orderId: string) {
    if (!this.state.highlighted[orderId]) return;
    const highlighted = { ...this.state.highlighted };
    delete highlighted[orderId];
    this.set({ highlighted });
  }
}
