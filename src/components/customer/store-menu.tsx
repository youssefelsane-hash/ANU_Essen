'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { estimateLine, useCart } from '@/client/cart';
import { MY_ORDERS_KEY, readJson, writeJson, type SavedOrder } from '@/client/storage';
import { formatMoney } from '@/lib/domain/misc';
import { STORE_STATUS_AR } from '@/lib/labels';
import type { PublicMenu, PublicMenuProduct } from '@/lib/types';

const STATUS_TONE = {
  OPEN: 'bg-green-100 text-green-800',
  BUSY: 'bg-amber-100 text-amber-800',
  PAUSED: 'bg-red-100 text-red-700',
  CLOSED: 'bg-gray-200 text-gray-700',
} as const;

export function StoreMenu({ menu }: { menu: PublicMenu }) {
  const slug = menu.restaurant.slug;
  const { lines, add } = useCart(slug);
  const [selected, setSelected] = useState<PublicMenuProduct | null>(null);
  const [activeOrder, setActiveOrder] = useState<SavedOrder | null>(null);
  const accepting = menu.store.status === 'OPEN' || menu.store.status === 'BUSY';
  const defaultPoint = menu.deliveryPoints.find((p) => p.isDefault) ?? menu.deliveryPoints[0];

  useEffect(() => {
    const utm = new URLSearchParams(window.location.search).get('utm_source');
    if (utm) writeJson(`utm:${slug}`, utm.slice(0, 64), 'session');
    const recent = readJson<SavedOrder[]>(MY_ORDERS_KEY, []).find((o) => o.slug === slug && Date.now() - o.createdAt < 3 * 3600_000);
    setActiveOrder(recent ?? null);
  }, [slug]);

  const totals = useMemo(() => {
    let count = 0;
    let total = 0;
    for (const l of lines) {
      const e = estimateLine(menu, l);
      count += l.quantity;
      total += e.total;
    }
    return { count, total };
  }, [lines, menu]);

  const byCategory = menu.categories
    .map((c) => ({ ...c, products: menu.products.filter((p) => p.categoryId === c.id) }))
    .filter((c) => c.products.length > 0);

  const quickAdd = (p: PublicMenuProduct) => {
    const needsChoice = p.variants.length > 0 || p.addonGroupIds.length > 0;
    if (needsChoice) setSelected(p);
    else add(p.id, null, [], 1);
  };

  return (
    <main className="mx-auto max-w-xl pb-32">
      <header className="bg-white px-4 pt-5 pb-3 shadow-sm">
        <div className="flex items-center gap-3">
          {menu.restaurant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={menu.restaurant.logoUrl} alt="" width={52} height={52} className="size-13 rounded-2xl object-cover" />
          ) : (
            <div className="grid size-13 place-items-center rounded-2xl bg-orange-600 text-2xl font-black text-white">{menu.restaurant.nameAr.slice(0, 1)}</div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold">{menu.restaurant.nameAr}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={`badge ${STATUS_TONE[menu.store.status]}`}>{STORE_STATUS_AR[menu.store.status]}</span>
              {accepting && <span className="text-gray-600">⏱️ يوصلك خلال ~{menu.store.etaMinutes} دقيقة</span>}
            </div>
          </div>
        </div>
        {defaultPoint && (
          <div className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-900">
            📍 الاستلام: <b>{defaultPoint.nameAr}</b>
          </div>
        )}
      </header>

      {!accepting && (
        <div className="mx-4 mt-4 rounded-2xl bg-red-50 p-4 text-center font-semibold text-red-800 ring-1 ring-red-200">
          {menu.store.status === 'PAUSED' ? 'الطلبات متوقفة مؤقتًا بسبب ضغط الطلبات' : 'المحل مغلق حاليًا'}
          <div className="mt-1 text-xs font-normal text-red-700">تقدر تتفرج على المنيو وترجع تطلب بعد شوية</div>
        </div>
      )}

      {activeOrder && (
        <Link href={`/order/${activeOrder.token}`} className="mx-4 mt-4 flex items-center justify-between rounded-2xl bg-gray-900 px-4 py-3 text-white">
          <span>طلبك #{activeOrder.orderNumber}</span>
          <span className="text-sm font-semibold text-orange-300">تابع الطلب ←</span>
        </Link>
      )}

      {menu.banners.length > 0 && (
        <div className="no-scrollbar mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4">
          {menu.banners.map((b) => (
            <div
              key={b.id}
              className="relative min-h-28 w-[85%] shrink-0 snap-center overflow-hidden rounded-2xl p-4"
              style={{ backgroundColor: b.bgColor, color: b.textColor }}
            >
              {b.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-40" />
              )}
              <div className="relative">
                <div className="text-lg leading-snug font-extrabold">{b.titleAr}</div>
                {b.subtitleAr && <div className="mt-1 text-sm opacity-90">{b.subtitleAr}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <nav className="no-scrollbar sticky top-0 z-10 mt-4 flex gap-2 overflow-x-auto bg-[#f6f5f3]/95 px-4 py-2 backdrop-blur">
        {byCategory.map((c) => (
          <a key={c.id} href={`#cat-${c.id}`} className="shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-semibold ring-1 ring-gray-200">
            {c.nameAr}
          </a>
        ))}
      </nav>

      <div className="space-y-6 px-4 pt-2">
        {byCategory.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-14">
            <h2 className="mb-2 text-lg font-bold">{c.nameAr}</h2>
            <div className="space-y-2">
              {c.products.map((p) => {
                const inCart = lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.quantity, 0);
                const minPrice = p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : p.basePrice;
                return (
                  <div key={p.id} className={`card flex gap-3 p-3 ${p.isAvailable ? '' : 'opacity-50'}`}>
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" loading="lazy" decoding="async" width={80} height={80} className="size-20 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <div className="grid size-20 shrink-0 place-items-center rounded-xl bg-orange-50 text-3xl">🌯</div>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="font-bold">{p.nameAr}</div>
                      {p.descriptionAr && <div className="line-clamp-2 text-xs text-gray-500">{p.descriptionAr}</div>}
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <div className="font-bold text-orange-700">
                          {p.variants.length > 1 && <span className="text-xs font-normal text-gray-500">من </span>}
                          {formatMoney(minPrice)}
                        </div>
                        {p.isAvailable ? (
                          <button className="btn btn-primary btn-sm min-w-16" onClick={() => quickAdd(p)} aria-label={`إضافة ${p.nameAr}`}>
                            {inCart > 0 ? `${inCart} في السلة +` : 'إضافة +'}
                          </button>
                        ) : (
                          <span className="text-xs font-semibold text-gray-500">غير متاح حاليًا</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {totals.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl p-3">
          <Link
            href={`/s/${slug}/checkout`}
            className={`btn btn-lg w-full justify-between shadow-lg ${accepting ? 'btn-primary' : 'btn-dark'}`}
          >
            <span className="grid size-7 place-items-center rounded-full bg-white/25 text-sm">{totals.count}</span>
            <span>{accepting ? 'كمّل الطلب' : 'السلة'}</span>
            <span>{formatMoney(totals.total)}</span>
          </Link>
        </div>
      )}

      {selected && <ProductSheet menu={menu} product={selected} onClose={() => setSelected(null)} onAdd={(v, a, q) => { add(selected.id, v, a, q); setSelected(null); }} />}
    </main>
  );
}

function ProductSheet({
  menu,
  product,
  onClose,
  onAdd,
}: {
  menu: PublicMenu;
  product: PublicMenuProduct;
  onClose: () => void;
  onAdd: (variantId: string | null, addonIds: string[], qty: number) => void;
}) {
  const firstAvailable = product.variants.find((v) => v.isAvailable) ?? null;
  const [variantId, setVariantId] = useState<string | null>(firstAvailable?.id ?? null);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const groups = menu.addonGroups.filter((g) => product.addonGroupIds.includes(g.id));
  const variant = product.variants.find((v) => v.id === variantId);
  const unit = (variant?.price ?? product.basePrice) + groups.flatMap((g) => g.addons).filter((a) => addonIds.includes(a.id)).reduce((s, a) => s + a.price, 0);
  const missingGroup = groups.find((g) => g.addons.filter((a) => addonIds.includes(a.id)).length < g.minSelect);
  const canAdd = (product.variants.length === 0 || !!variant) && !missingGroup;

  const toggleAddon = (groupId: string, addonId: string) => {
    const group = groups.find((g) => g.id === groupId)!;
    setAddonIds((cur) => {
      if (cur.includes(addonId)) return cur.filter((x) => x !== addonId);
      const inGroup = cur.filter((x) => group.addons.some((a) => a.id === x));
      if (group.maxSelect === 1) return [...cur.filter((x) => !inGroup.includes(x)), addonId];
      if (group.maxSelect > 0 && inGroup.length >= group.maxSelect) return cur;
      return [...cur, addonId];
    });
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose} role="dialog" aria-modal="true">
      <div className="max-h-[88dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-extrabold">{product.nameAr}</h3>
            {product.descriptionAr && <p className="text-sm text-gray-500">{product.descriptionAr}</p>}
          </div>
          <button className="btn btn-ghost btn-sm text-lg" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>

        {product.variants.length > 0 && (
          <fieldset className="mb-4">
            <legend className="mb-2 font-bold">الحجم</legend>
            <div className="space-y-2">
              {product.variants.map((v) => (
                <label key={v.id} className={`flex items-center justify-between rounded-xl px-3 py-3 ring-1 ${variantId === v.id ? 'bg-orange-50 ring-orange-400' : 'ring-gray-200'} ${v.isAvailable ? '' : 'opacity-40'}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="variant" checked={variantId === v.id} disabled={!v.isAvailable} onChange={() => setVariantId(v.id)} className="accent-orange-600" />
                    {v.nameAr} {!v.isAvailable && '(غير متاح)'}
                  </span>
                  <span className="font-semibold">{formatMoney(v.price)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {groups.map((g) => (
          <fieldset key={g.id} className="mb-4">
            <legend className="mb-2 font-bold">
              {g.nameAr}{' '}
              <span className="text-xs font-normal text-gray-500">
                {g.minSelect > 0 ? `(اختار ${g.minSelect} على الأقل)` : '(اختياري)'} {g.maxSelect > 1 ? `حتى ${g.maxSelect}` : ''}
              </span>
            </legend>
            <div className="space-y-2">
              {g.addons.map((a) => (
                <label key={a.id} className={`flex items-center justify-between rounded-xl px-3 py-2.5 ring-1 ${addonIds.includes(a.id) ? 'bg-orange-50 ring-orange-400' : 'ring-gray-200'} ${a.isAvailable ? '' : 'opacity-40'}`}>
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={addonIds.includes(a.id)} disabled={!a.isAvailable} onChange={() => toggleAddon(g.id, a.id)} className="accent-orange-600" />
                    {a.nameAr}
                  </span>
                  <span className="text-sm">{a.price > 0 ? `+${formatMoney(a.price)}` : 'مجانًا'}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="mt-2 flex items-center gap-3">
          <div className="flex items-center rounded-2xl ring-1 ring-gray-300">
            <button className="btn btn-ghost px-4 text-xl" onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label="زيادة">+</button>
            <span className="w-8 text-center text-lg font-bold">{qty}</span>
            <button className="btn btn-ghost px-4 text-xl" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="تقليل">−</button>
          </div>
          <button className="btn btn-primary btn-lg flex-1" disabled={!canAdd} onClick={() => onAdd(variantId, addonIds, qty)}>
            أضف للسلة • {formatMoney(unit * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}
