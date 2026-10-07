import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OfflineAction, OrderSnapshot, StoreLive } from '@/lib/types';

export interface OutboxEntry extends OfflineAction {
  createdAt: number;
  attempts: number;
  lastError?: string | null;
}

export interface MetaValues {
  cursor: number;
  store: StoreLive | null;
  serverOffset: number;
  lastSyncAt: number | null;
}

interface MerchantDB extends DBSchema {
  /** Server snapshots of orders — the device works from these when offline. */
  orders: { key: string; value: OrderSnapshot };
  /** Actions taken on this device that the server has not acknowledged yet. */
  outbox: { key: string; value: OutboxEntry; indexes: { byCreated: number } };
  meta: { key: keyof MetaValues; value: MetaValues[keyof MetaValues] };
}

export type LocalDb = IDBPDatabase<MerchantDB>;

/** One IndexedDB database per restaurant (a super admin may switch between stores on one device). */
export function openLocalDb(restaurantId: string): Promise<LocalDb> {
  return openDB<MerchantDB>(`merchant:${restaurantId}`, 1, {
    upgrade(db) {
      db.createObjectStore('orders', { keyPath: 'id' });
      const outbox = db.createObjectStore('outbox', { keyPath: 'eventId' });
      outbox.createIndex('byCreated', 'createdAt');
      db.createObjectStore('meta');
    },
  });
}

export async function readMeta<K extends keyof MetaValues>(db: LocalDb, key: K, fallback: MetaValues[K]): Promise<MetaValues[K]> {
  const v = await db.get('meta', key);
  return (v as MetaValues[K] | undefined) ?? fallback;
}
