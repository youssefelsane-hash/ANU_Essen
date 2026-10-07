'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { readJson, writeJson } from './storage';
import { localizedName, text, type Locale } from '@/lib/i18n';
import type { PublicMenu } from '@/lib/types';

export interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
}

const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();
const cache = new Map<string, CartLine[]>();
const storageKey = (slug: string) => `cart:v1:${slug}`;

function load(slug: string): CartLine[] {
  if (!cache.has(slug)) cache.set(slug, normalizeCart(readJson<unknown>(storageKey(slug), [])));
  return cache.get(slug)!;
}

function save(slug: string, lines: CartLine[]) {
  cache.set(slug, lines);
  writeJson(storageKey(slug), lines);
  listeners.forEach((l) => l());
}

export const lineKey = (productId: string, variantId: string | null, addonIds: string[]) =>
  [productId, variantId ?? '-', [...addonIds].sort().join('.')].join('|');

/** Saved carts may outlive a deployment or contain damaged browser storage. */
export function normalizeCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const lines = new Map<string, CartLine>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Partial<CartLine>;
    if (typeof row.productId !== 'string' || !row.productId ||
        (row.variantId !== null && row.variantId !== undefined && typeof row.variantId !== 'string') ||
        !Number.isInteger(row.quantity) || (row.quantity ?? 0) <= 0 ||
        !Array.isArray(row.addonIds) || row.addonIds.some((id) => typeof id !== 'string' || !id)) continue;
    const variantId = row.variantId || null;
    const addonIds = [...new Set(row.addonIds)].sort().slice(0, 20);
    const key = lineKey(row.productId, variantId, addonIds);
    const existing = lines.get(key);
    if (!existing && lines.size >= 30) continue;
    lines.set(key, { key, productId: row.productId, variantId, addonIds, quantity: Math.min(50, (existing?.quantity ?? 0) + row.quantity!) });
  }
  return [...lines.values()];
}

export function useCart(slug: string) {
  const lines = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey(slug) || e.key === null) {
          cache.delete(slug);
          cb();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
      };
    },
    () => load(slug),
    () => EMPTY,
  );

  const add = useCallback(
    (productId: string, variantId: string | null, addonIds: string[], quantity: number) => {
      if (!Number.isInteger(quantity) || quantity <= 0) return;
      addonIds = [...new Set(addonIds)].sort();
      const key = lineKey(productId, variantId, addonIds);
      const current = load(slug);
      const existing = current.find((l) => l.key === key);
      save(
        slug,
        existing
          ? current.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, l.quantity + quantity) } : l))
          : [...current, { key, productId, variantId, addonIds, quantity: Math.min(50, quantity) }],
      );
    },
    [slug],
  );
  const setQuantity = useCallback(
    (key: string, quantity: number) => {
      if (!Number.isInteger(quantity)) return;
      const current = load(slug);
      save(slug, quantity <= 0 ? current.filter((l) => l.key !== key) : current.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l)));
    },
    [slug],
  );
  const clear = useCallback(() => save(slug, []), [slug]);
  /** Replace the cart (e.g. "order it again"); input is validated like stored carts. */
  const replace = useCallback((next: Omit<CartLine, 'key'>[]) => save(slug, normalizeCart(next)), [slug]);
  return { lines, add, setQuantity, clear, replace };
}

/** Display-only price estimate; the server re-prices everything at checkout. */
export function estimateLine(menu: PublicMenu, line: CartLine, locale: Locale = 'ar'): { unit: number; total: number; name: string; detail: string; available: boolean } {
  const product = menu.products.find((p) => p.id === line.productId);
  if (!product) return { unit: 0, total: 0, name: text(locale, 'منتج غير متاح', 'Unavailable item'), detail: '', available: false };
  const variant = product.variants.find((v) => v.id === line.variantId);
  const groups = menu.addonGroups.filter((g) => product.addonGroupIds.includes(g.id));
  const selectedAddonIds = [...new Set(line.addonIds)];
  const addonList = groups.flatMap((g) => g.addons).filter((a) => selectedAddonIds.includes(a.id));
  const unit = (variant?.price ?? product.basePrice) + addonList.reduce((s, a) => s + a.price, 0);
  const detail = [variant ? localizedName(locale, variant.nameAr, variant.nameEn) : null, ...addonList.map((a) => localizedName(locale, a.nameAr, a.nameEn))].filter(Boolean).join(' • ');
  const validGroups = groups.every((g) => {
    const count = g.addons.filter((a) => selectedAddonIds.includes(a.id)).length;
    return count >= g.minSelect && (g.maxSelect === 0 || count <= g.maxSelect);
  });
  const available = product.isAvailable && (variant ? variant.isAvailable : product.variants.length === 0 && !line.variantId) &&
    addonList.length === selectedAddonIds.length && addonList.every((a) => a.isAvailable) && validGroups &&
    Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 50;
  return { unit, total: unit * line.quantity, name: localizedName(locale, product.nameAr, product.nameEn), detail, available };
}
