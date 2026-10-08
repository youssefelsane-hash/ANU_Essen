import { MerchantEngine, type EngineState } from './engine';
import type { OrderAction } from '@/lib/domain/order-machine';
import type { OrderSnapshot } from '@/lib/types';
import type { Locale } from '@/lib/i18n';

export interface CourierStore { id: string; nameAr: string; nameEn: string; timezone: string; permissions: string[]; }
export interface CourierStoreState { store: CourierStore; state: EngineState; error: boolean; }
export interface CourierBoardState { ready: boolean; stores: CourierStoreState[]; }
export interface CourierOrder { store: CourierStore; order: OrderSnapshot; pending: number; highlighted: boolean; }

/** Keep every restaurant's durable queue and sync cursor in its own existing engine/database. */
export class DeliveryBoardEngine {
  private engines = new Map<string, MerchantEngine>();
  private listeners = new Set<() => void>();
  private unsubscribers: (() => void)[] = [];
  private stopped = false;
  private state: CourierBoardState;

  constructor(stores: CourierStore[], userId: string, onAlert: (store: CourierStore, orders: OrderSnapshot[]) => void, getLocale: () => Locale) {
    this.state = { ready: stores.length === 0, stores: [] };
    for (const store of stores) {
      const engine = new MerchantEngine(store.id, userId, new Set(store.permissions), (orders) => {
        const visible = orders.filter((order) => order.restaurantId === store.id && courierJobStage(order, userId));
        if (visible.length) onAlert(store, visible);
      }, getLocale, 5000);
      this.engines.set(store.id, engine);
      this.state.stores.push({ store, state: engine.getState(), error: false });
    }
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getState = () => this.state;

  private update(storeId: string, error = false) {
    if (this.stopped) return;
    const stores = this.state.stores.map((entry) => entry.store.id === storeId ? { ...entry, state: this.engines.get(storeId)!.getState(), error } : entry);
    this.state = { ready: stores.every((entry) => entry.state.ready || entry.error), stores };
    this.listeners.forEach((listener) => listener());
  }

  async start() {
    await Promise.all(this.state.stores.map(async ({ store }, index) => {
      if (index) await new Promise((resolve) => setTimeout(resolve, index * 100));
      if (this.stopped) return;
      const engine = this.engines.get(store.id)!;
      this.unsubscribers.push(engine.subscribe(() => this.update(store.id)));
      try { await engine.start(); }
      catch { this.update(store.id, true); }
    }));
  }

  stop() {
    this.stopped = true;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.engines.forEach((engine) => engine.stop());
  }

  async dispatch(restaurantId: string, orderId: string, action: OrderAction): Promise<boolean> {
    if (this.stopped) return false;
    return await this.engines.get(restaurantId)?.dispatch(orderId, action) ?? false;
  }

  refresh = () => { if (!this.stopped) this.engines.forEach((engine) => { if (!engine.getState().accessDenied) void engine.syncNow(); }); };
  seen(restaurantId: string, orderId: string) { this.engines.get(restaurantId)?.unhighlight(orderId); }
}

/** Owners can use this screen too; their broader kitchen permissions must not ring for kitchen-only work. */
export function courierJobStage(order: OrderSnapshot, userId: string): 'ready' | 'mine' | null {
  if (order.fulfillment !== 'DELIVERY') return null;
  if (order.status === 'READY' && !order.assignedToUserId) return 'ready';
  if (order.assignedToUserId === userId && (order.status === 'OUT_FOR_DELIVERY' || order.status === 'ARRIVED_AT_GATE')) return 'mine';
  return null;
}

/** A courier sees ready delivery jobs and only the jobs they personally took. */
export function courierOrders(snapshot: CourierBoardState, userId: string, restaurantId = ''): { ready: CourierOrder[]; mine: CourierOrder[] } {
  const ready: CourierOrder[] = [], mine: CourierOrder[] = [];
  for (const entry of snapshot.stores) {
    if (entry.state.accessDenied || (restaurantId && entry.store.id !== restaurantId)) continue;
    for (const order of entry.state.orders) {
      if (order.restaurantId !== entry.store.id || order.fulfillment !== 'DELIVERY') continue;
      const row = { store: entry.store, order, pending: entry.state.pending[order.id] ?? 0, highlighted: !!entry.state.highlighted[order.id] };
      const stage = courierJobStage(order, userId);
      if (stage === 'ready') ready.push(row);
      else if (stage === 'mine') mine.push(row);
    }
  }
  ready.sort((a, b) => (a.order.readyAt ?? a.order.createdAt) - (b.order.readyAt ?? b.order.createdAt));
  mine.sort((a, b) => (a.order.outForDeliveryAt ?? a.order.createdAt) - (b.order.outForDeliveryAt ?? b.order.createdAt));
  return { ready, mine };
}
