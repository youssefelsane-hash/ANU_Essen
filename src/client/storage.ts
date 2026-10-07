/** Safe wrappers: storage can be unavailable (private mode, blocked site data). */
export function readJson<T>(key: string, fallback: T, store: 'local' | 'session' = 'local'): T {
  try {
    const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, store: 'local' | 'session' = 'local') {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function removeKey(key: string, store: 'local' | 'session' = 'local') {
  try {
    (store === 'local' ? localStorage : sessionStorage).removeItem(key);
  } catch {
    /* ignore */
  }
}

export interface SavedOrder {
  token: string;
  orderNumber: string;
  slug: string;
  createdAt: number;
}

export const MY_ORDERS_KEY = 'my-orders:v1';
export const PROFILE_KEY = 'customer-profile:v1';

export function rememberOrder(o: SavedOrder) {
  const list = readJson<SavedOrder[]>(MY_ORDERS_KEY, []).filter((x) => x.token !== o.token);
  writeJson(MY_ORDERS_KEY, [o, ...list].slice(0, 10));
}
