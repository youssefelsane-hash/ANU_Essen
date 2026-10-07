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

export interface SavedOrderLine {
  productId: string;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
}

export interface SavedOrder {
  token: string;
  orderNumber: string;
  slug: string;
  createdAt: number;
  /** What was ordered — powers one-tap "order it again". */
  lines?: SavedOrderLine[];
  total?: number;
}

export const MY_ORDERS_KEY = 'my-orders:v1';
export const PROFILE_KEY = 'customer-profile:v1';

/** Last payment method / pickup point per restaurant, preselected next time. */
export interface CheckoutPrefs {
  paymentMethod?: 'INSTAPAY' | 'CASH';
  deliveryPointId?: string;
}
export const prefsKey = (slug: string) => 'checkout-prefs:v1:' + slug;

/** Most recent order on this phone for a restaurant that can be repeated (optionally a specific one). */
export function lastOrderFor(slug: string, token?: string | null): SavedOrder | null {
  const list = readJson<SavedOrder[]>(MY_ORDERS_KEY, []);
  if (!Array.isArray(list)) return null;
  const withLines = list.filter((o) => o && o.slug === slug && Array.isArray(o.lines) && o.lines.length > 0);
  return (token ? withLines.find((o) => o.token === token) : undefined) ?? withLines[0] ?? null;
}

export function rememberOrder(o: SavedOrder) {
  const list = readJson<SavedOrder[]>(MY_ORDERS_KEY, []).filter((x) => x.token !== o.token);
  writeJson(MY_ORDERS_KEY, [o, ...list].slice(0, 10));
}
