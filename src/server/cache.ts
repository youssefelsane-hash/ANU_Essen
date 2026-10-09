/**
 * Tiny per-instance cache for hot public reads (menu, home). Concurrent requests share one in-flight
 * load, and results live a few seconds — enough to absorb a rush without serving stale prices for long.
 * Failures are never cached.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX_KEYS = 500;

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: now, value });
  value.catch(() => { if (store.get(key)?.value === value) store.delete(key); });
  if (store.size > MAX_KEYS) store.delete(store.keys().next().value!);
  return value;
}

/** Drop cached entries (e.g. right after a staff edit on this instance). */
export function forget(prefix: string) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
