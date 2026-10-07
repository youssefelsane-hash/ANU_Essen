'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { readJson, writeJson } from './storage';
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
  if (!cache.has(slug)) cache.set(slug, readJson<CartLine[]>(storageKey(slug), []));
  return cache.get(slug)!;
}

function save(slug: string, lines: CartLine[]) {
  cache.set(slug, lines);
  writeJson(storageKey(slug), lines);
  listeners.forEach((l) => l());
}

export const lineKey = (productId: string, variantId: string | null, addonIds: string[]) =>
  [productId, variantId ?? '-', [...addonIds].sort().join('.')].join('|');

export function useCart(slug: string) {
  const lines = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey(slug)) {
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
      const key = lineKey(productId, variantId, addonIds);
      const current = load(slug);
      const existing = current.find((l) => l.key === key);
      save(
        slug,
        existing
          ? current.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, l.quantity + quantity) } : l))
          : [...current, { key, productId, variantId, addonIds, quantity }],
      );
    },
    [slug],
  );
  const setQuantity = useCallback(
    (key: string, quantity: number) => {
      const current = load(slug);
      save(slug, quantity <= 0 ? current.filter((l) => l.key !== key) : current.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l)));
    },
    [slug],
  );
  const clear = useCallback(() => save(slug, []), [slug]);
  return { lines, add, setQuantity, clear };
}

/** Display-only price estimate; the server re-prices everything at checkout. */
export function estimateLine(menu: PublicMenu, line: CartLine): { unit: number; total: number; name: string; detail: string; available: boolean } {
  const product = menu.products.find((p) => p.id === line.productId);
  if (!product) return { unit: 0, total: 0, name: 'منتج غير متاح', detail: '', available: false };
  const variant = product.variants.find((v) => v.id === line.variantId);
  const addonList = menu.addonGroups.flatMap((g) => g.addons).filter((a) => line.addonIds.includes(a.id));
  const unit = (variant?.price ?? product.basePrice) + addonList.reduce((s, a) => s + a.price, 0);
  const detail = [variant?.nameAr, ...addonList.map((a) => a.nameAr)].filter(Boolean).join(' • ');
  const available = product.isAvailable && (variant ? variant.isAvailable : product.variants.length === 0) && addonList.every((a) => a.isAvailable);
  return { unit, total: unit * line.quantity, name: product.nameAr, detail, available };
}
