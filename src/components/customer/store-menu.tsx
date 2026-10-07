'use client';

import Link from 'next/link';
import { ArrowLeft, Check, Clock3, MapPin, Minus, Plus, Search, ShoppingBag, UtensilsCrossed, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { estimateLine, useCart } from '@/client/cart';
import { MY_ORDERS_KEY, readJson, writeJson, type SavedOrder } from '@/client/storage';
import { formatMoney } from '@/lib/domain/misc';
import { STORE_STATUS_AR } from '@/lib/labels';
import { brandTextColor } from '@/lib/domain/restaurant-brand';
import type { PublicMenu, PublicMenuProduct } from '@/lib/types';
import './customer.css';

const searchable = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي');

export function StoreMenu({ menu: initialMenu }: { menu: PublicMenu }) {
  const [menu, setMenu] = useState(initialMenu);
  const slug = menu.restaurant.slug;
  const { lines, add } = useCart(slug);
  const [selected, setSelected] = useState<PublicMenuProduct | null>(null);
  const closeSheet = useCallback(() => setSelected(null), []);
  const [activeOrder, setActiveOrder] = useState<SavedOrder | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [notice, setNotice] = useState('');
  const accepting = menu.store.status === 'OPEN' || menu.store.status === 'BUSY';
  const defaultPoint = menu.deliveryPoints.find((p) => p.isDefault) ?? menu.deliveryPoints[0];

  useEffect(() => {
    const utm = new URLSearchParams(window.location.search).get('utm_source');
    if (utm) writeJson('utm:' + slug, utm.slice(0, 64), 'session');
    const recent = readJson<SavedOrder[]>(MY_ORDERS_KEY, []).find((o) => o.slug === slug && Date.now() - o.createdAt < 3 * 3600_000);
    setActiveOrder(recent ?? null);
    const ctrl = new AbortController();
    const refresh = async () => {
      if (document.hidden || !navigator.onLine) return;
      try {
        const res = await fetch('/api/public/stores/' + slug, { cache: 'no-store', signal: ctrl.signal });
        if (res.ok) setMenu(await res.json() as PublicMenu);
      } catch { /* The last menu remains usable while offline. */ }
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(timer);
      ctrl.abort();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [slug]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const totals = useMemo(() => lines.reduce((sum, line) => ({
    count: sum.count + line.quantity,
    total: sum.total + estimateLine(menu, line).total,
  }), { count: 0, total: 0 }), [lines, menu]);

  const byCategory = useMemo(() => menu.categories
    .filter((c) => category === 'all' || c.id === category)
    .map((c) => ({
      ...c,
      products: menu.products.filter((p) => p.categoryId === c.id && searchable(p.nameAr + ' ' + p.nameEn + ' ' + (p.descriptionAr ?? '')).includes(searchable(query.trim()))),
    })).filter((c) => c.products.length > 0), [menu, category, query]);
  const totalProducts = byCategory.reduce((sum, c) => sum + c.products.length, 0);
  const categories = menu.categories.filter((c) => menu.products.some((p) => p.categoryId === c.id));
  const heroImage = menu.restaurant.coverImageUrl || menu.banners.find((b) => b.imageUrl)?.imageUrl;
  const brand = menu.restaurant;
  const brandColor = brand.brandColor || '#263c2c';

  const addProduct = (product: PublicMenuProduct, variantId: string | null, addonIds: string[], qty: number) => {
    add(product.id, variantId, addonIds, qty);
    setNotice('أضفنا ' + product.nameAr + ' للسلة');
  };
  const quickAdd = (product: PublicMenuProduct) => {
    if (product.variants.length || product.addonGroupIds.length) setSelected(product);
    else addProduct(product, null, [], 1);
  };

  return (
    <main className="customer-page" style={{ '--customer-brand': brandColor, '--customer-brand-text': brandTextColor(brandColor) } as CSSProperties}>
      <header className="customer-topbar">
        <Link href={'/s/' + slug} className="restaurant-wordmark" aria-label={'منيو ' + menu.restaurant.nameAr}>
          <span className="restaurant-mark">
            {menu.restaurant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={menu.restaurant.logoUrl} alt="" width={48} height={48} />
            ) : <UtensilsCrossed size={22} strokeWidth={1.6} />}
          </span>
          <span><strong>{menu.restaurant.nameAr}</strong><small>{brand.badgeText || 'طلب مباشر من المطعم'}</small></span>
        </Link>
        <div className="topbar-status"><span className={'status-dot ' + (accepting ? 'is-open' : 'is-closed')} />{STORE_STATUS_AR[menu.store.status]}</div>
      </header>

      <div className="store-layout">
        <div className="store-content">
          <section className={'restaurant-hero ' + (heroImage ? 'has-image' : '')} aria-label="أهلًا بك">
            {heroImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroImage} alt="" fetchPriority="high" decoding="async" className="hero-photo" />
            )}
            <div className="hero-content">
              <span className="hero-eyebrow"><span />{brand.badgeText || 'من المطبخ، لحد عندك'}</span>
              <h1>{menu.restaurant.nameAr}</h1>
              <p>{brand.taglineAr || 'اختار اللي بتحبه. هنجهّز طلبك، وتتابعه معانا خطوة بخطوة.'}</p>
              <a href="#menu" className="hero-link">اكتشف المنيو <ArrowLeft size={16} /></a>
            </div>
            <div className="hero-caption"><UtensilsCrossed size={16} /><span>اختياراتك، على ذوقك.</span></div>
          </section>

          <div className="store-service-strip">
            <div><span className="service-icon"><Clock3 size={20} /></span><span><small>وقت الوصول المتوقع</small><strong>{accepting ? menu.store.etaMinutes + ' دقيقة تقريبًا' : 'الطلب غير متاح حاليًا'}</strong></span></div>
            <div><span className="service-icon"><MapPin size={20} /></span><span><small>نقطة الاستلام</small><strong>{defaultPoint?.nameAr ?? 'تتحدد عند الطلب'}</strong></span></div>
          </div>

          {!accepting && (
            <div className="customer-alert" role="status">
              <strong>{menu.store.status === 'PAUSED' ? 'المطبخ بياخد استراحة قصيرة من الطلبات' : 'المطعم مغلق حاليًا'}</strong>
              <p>تقدر تختار أكلك وتحفظه في السلة. هنحدّث حالة المطعم تلقائيًا.</p>
            </div>
          )}

          {activeOrder && (
            <Link href={'/order/' + activeOrder.token} className="active-order-link">
              <span className="active-order-icon"><ShoppingBag size={20} /></span>
              <span><small>عندك طلب حديث</small><strong>طلب رقم {activeOrder.orderNumber}</strong></span>
              <span className="active-order-action">تابع طلبك <ArrowLeft size={16} /></span>
            </Link>
          )}

          {menu.banners.length > 0 && (
            <div className="menu-promotions no-scrollbar" role="region" tabIndex={0} aria-label="عروض وإعلانات المطعم">
              {menu.banners.map((banner, i) => (
                <div key={banner.id} className={'menu-promotion ' + (i % 2 ? 'promotion-olive' : 'promotion-amber')}>
                  <span className="promotion-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <div><strong>{banner.titleAr}</strong>{banner.subtitleAr && <p>{banner.subtitleAr}</p>}</div>
                </div>
              ))}
            </div>
          )}

          <section id="menu" className="menu-section">
            <div className="section-heading"><div><span className="section-eyebrow">اختار وجبتك</span><h2>المنيو</h2></div><span>{menu.products.length} أصناف</span></div>
            <label className="menu-search">
              <Search size={19} /><input aria-label="ابحث في المنيو" placeholder="نفسك في إيه؟ ابحث عن وجبتك…" value={query} onChange={(e) => setQuery(e.target.value)} />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="مسح البحث"><X size={17} /></button>}
            </label>
            <nav className="category-tabs no-scrollbar" aria-label="أقسام المنيو">
              <button type="button" className={category === 'all' ? 'is-active' : ''} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>كل المنيو</button>
              {categories.map((c) => <button type="button" key={c.id} className={category === c.id ? 'is-active' : ''} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.nameAr}</button>)}
            </nav>

            {query && <p className="search-result-count" aria-live="polite">{totalProducts} نتائج للبحث عن «{query}»</p>}
            {byCategory.length === 0 && (
              <div className="customer-empty"><Search size={32} strokeWidth={1.4} /><h3>{query ? 'ملقيناش الصنف ده' : 'المنيو بيتجهّز'}</h3><p>{query ? 'جرّب اسم تاني أو شوف كل الاختيارات.' : 'ارجع لنا قريب وشوف الأصناف الجديدة.'}</p>{(query || category !== 'all') && <button className="customer-secondary-button" onClick={() => { setQuery(''); setCategory('all'); }}>عرض كل المنيو</button>}</div>
            )}
            {byCategory.map((c) => (
              <section key={c.id} className="product-category" aria-labelledby={'category-' + c.id}>
                <div className="category-heading"><h3 id={'category-' + c.id}>{c.nameAr}</h3><span>{c.products.length} أصناف</span></div>
                <div className="product-grid">
                  {c.products.map((product) => {
                    const inCart = lines.filter((l) => l.productId === product.id).reduce((sum, l) => sum + l.quantity, 0);
                    const availableVariants = product.variants.filter((v) => v.isAvailable);
                    const available = product.isAvailable && (!product.variants.length || availableVariants.length > 0);
                    const minPrice = availableVariants.length ? Math.min(...availableVariants.map((v) => v.price)) : product.basePrice;
                    return (
                      <article key={product.id} className={'menu-product ' + (!available ? 'product-unavailable' : '')}>
                        <button type="button" className="product-image-button" onClick={() => setSelected(product)} aria-label={'تفاصيل ' + product.nameAr}>
                          {product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.imageUrl} alt={product.nameAr} loading="lazy" decoding="async" width={160} height={160} />
                          ) : <span className="product-image-placeholder"><UtensilsCrossed size={32} strokeWidth={1.2} /><small>{c.nameAr}</small></span>}
                          {inCart > 0 && <span className="product-cart-count"><Check size={12} />{inCart}</span>}
                        </button>
                        <div className="product-info">
                          <button type="button" className="product-name-button" onClick={() => setSelected(product)}><h4>{product.nameAr}</h4></button>
                          <p>{product.descriptionAr || 'حضّر طلبك بالطريقة اللي بتحبها.'}</p>
                          <div className="product-action-row">
                            <strong className="product-price">{product.variants.length > 1 && <small>من </small>}{formatMoney(minPrice)}</strong>
                            {available ? <button className="product-add-button" onClick={() => quickAdd(product)} aria-label={'إضافة ' + product.nameAr + ' للسلة'}><Plus size={18} /><span>إضافة</span></button> : <span className="product-unavailable-label">غير متاح</span>}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </section>
          <footer className="store-footer"><span>{menu.restaurant.nameAr}</span><p>طلبك مباشر من المطعم. الأسعار والوقت بيتأكدوا قبل تأكيد الطلب.</p>{menu.restaurant.phone && <a href={'tel:' + menu.restaurant.phone}>اتصل بالمطعم</a>}</footer>
        </div>

        <aside className="store-sidebar">
          <div className="desktop-basket">
            <div className="basket-heading"><ShoppingBag size={21} /><h2>طلبك، على ذوقك</h2><span>{totals.count}</span></div>
            {lines.length ? <div className="basket-preview-lines">{lines.map((line) => { const item = estimateLine(menu, line); return <div key={line.key}><span><b>{line.quantity} × </b>{item.name}</span><strong>{formatMoney(item.total)}</strong></div>; })}</div> : <div className="basket-empty"><ShoppingBag size={37} strokeWidth={1.2} /><p>كل الحلو بيبدأ باختيار.</p><span>ضيف وجبتك المفضلة، والباقي علينا.</span></div>}
            <div className="basket-total"><span>المجموع المبدئي</span><strong>{formatMoney(totals.total)}</strong></div>
            <Link href={'/s/' + slug + '/checkout'} className={'customer-primary-button ' + (!lines.length ? 'is-disabled' : '')} aria-disabled={!lines.length} tabIndex={lines.length ? 0 : -1}>مراجعة الطلب <ArrowLeft size={17} /></Link>
            <p className="basket-footnote">التوصيل والخصم بيتحسبوا في الخطوة الجاية.</p>
          </div>
          <div className="order-promise"><Clock3 size={21} /><h3>وقتك مهم.</h3><p>هتعرف وقت الوصول المتوقع قبل ما تأكد، وتتابع تجهيز طلبك لحظة بلحظة.</p></div>
        </aside>
      </div>

      <div className={'cart-toast ' + (notice ? 'is-visible' : '')} role="status" aria-live="polite"><Check size={17} />{notice}</div>
      {totals.count > 0 && <div className="mobile-cart-bar"><Link href={'/s/' + slug + '/checkout'} className="customer-primary-button"><span className="cart-count">{totals.count}</span><span>مراجعة الطلب</span><strong>{formatMoney(totals.total)}</strong><ArrowLeft size={18} /></Link></div>}
      {selected && <ProductSheet key={selected.id} menu={menu} product={menu.products.find((p) => p.id === selected.id) ?? selected} onClose={closeSheet} onAdd={(v, a, q) => { addProduct(selected, v, a, q); setSelected(null); }} />}
    </main>
  );
}

function ProductSheet({ menu, product, onClose, onAdd }: {
  menu: PublicMenu; product: PublicMenuProduct; onClose: () => void;
  onAdd: (variantId: string | null, addonIds: string[], qty: number) => void;
}) {
  const firstAvailable = product.variants.find((v) => v.isAvailable && v.isDefault) ?? product.variants.find((v) => v.isAvailable);
  const [variantId, setVariantId] = useState<string | null>(firstAvailable?.id ?? null);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const panel = useRef<HTMLDivElement>(null);
  const groups = menu.addonGroups.filter((g) => product.addonGroupIds.includes(g.id));
  const variant = product.variants.find((v) => v.id === variantId);
  const selectedAddons = groups.flatMap((g) => g.addons).filter((a) => addonIds.includes(a.id));
  const unit = (variant?.price ?? product.basePrice) + selectedAddons.reduce((sum, a) => sum + a.price, 0);
  const missingGroup = groups.find((g) => g.addons.filter((a) => addonIds.includes(a.id) && a.isAvailable).length < g.minSelect);
  const canAdd = product.isAvailable && (!product.variants.length || !!variant?.isAvailable) && !missingGroup && selectedAddons.every((a) => a.isAvailable);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const elements = panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]');
      if (!elements?.length) { event.preventDefault(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const toggleAddon = (groupId: string, addonId: string) => {
    const group = groups.find((g) => g.id === groupId)!;
    setAddonIds((current) => {
      if (current.includes(addonId)) return current.filter((id) => id !== addonId);
      const inGroup = current.filter((id) => group.addons.some((a) => a.id === id));
      if (group.maxSelect === 1) return [...current.filter((id) => !inGroup.includes(id)), addonId];
      if (group.maxSelect > 0 && inGroup.length >= group.maxSelect) return current;
      return [...current, addonId];
    });
  };

  return (
    <div className="product-modal-backdrop" onClick={onClose}>
      <div className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-sheet-title" aria-describedby="product-sheet-description" tabIndex={-1} ref={panel} onClick={(event) => event.stopPropagation()}>
        <div className="product-modal-heading">
          <div><span className="section-eyebrow">خلّيها على ذوقك</span><h2 id="product-sheet-title">{product.nameAr}</h2><p id="product-sheet-description">{product.descriptionAr || 'اختار تفاصيل وجبتك والكمية المناسبة.'}</p></div>
          <button type="button" className="customer-icon-button" onClick={onClose} aria-label="إغلاق تفاصيل المنتج"><X size={21} /></button>
        </div>
        <div className="product-modal-body">
          {product.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="product-modal-photo" src={product.imageUrl} alt={product.nameAr} width={640} height={300} />
          )}
          {product.variants.length > 0 && <fieldset className="product-options"><legend>اختار الحجم <span>مطلوب</span></legend>{product.variants.map((v) => <label key={v.id} className={'customer-choice ' + (variantId === v.id ? 'is-selected' : '') + (!v.isAvailable ? ' is-unavailable' : '')}><input type="radio" name="product-variant" checked={variantId === v.id} disabled={!v.isAvailable} onChange={() => setVariantId(v.id)} /><span>{v.nameAr}{!v.isAvailable && <small>غير متاح</small>}</span><strong>{formatMoney(v.price)}</strong></label>)}</fieldset>}
          {groups.map((group) => {
            const count = group.addons.filter((a) => addonIds.includes(a.id)).length;
            return <fieldset className="product-options" key={group.id}><legend>{group.nameAr}<span>{group.minSelect > 0 ? 'مطلوب · ' + group.minSelect + ' على الأقل' : 'اختياري'}{group.maxSelect > 0 ? ' · لحد ' + group.maxSelect : ''}</span></legend>{group.addons.map((addon) => <label key={addon.id} className={'customer-choice ' + (addonIds.includes(addon.id) ? 'is-selected' : '') + (!addon.isAvailable ? ' is-unavailable' : '')}><input type="checkbox" name={'addon-' + group.id} checked={addonIds.includes(addon.id)} disabled={!addon.isAvailable || (!addonIds.includes(addon.id) && group.maxSelect > 1 && count >= group.maxSelect)} onChange={() => toggleAddon(group.id, addon.id)} /><span>{addon.nameAr}{!addon.isAvailable && <small>غير متاح</small>}</span><strong>{addon.price ? '+ ' + formatMoney(addon.price) : 'مجانًا'}</strong></label>)}</fieldset>;
          })}
          {!product.isAvailable && <p className="customer-alert">الصنف ده غير متاح حاليًا.</p>}
          {missingGroup && <p className="option-hint">اختار {missingGroup.minSelect} على الأقل من «{missingGroup.nameAr}».</p>}
        </div>
        <div className="product-modal-footer">
          <div className="quantity-control"><button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty === 1} aria-label="تقليل الكمية"><Minus size={17} /></button><output aria-label="الكمية">{qty}</output><button type="button" onClick={() => setQty((q) => Math.min(50, q + 1))} disabled={qty === 50} aria-label="زيادة الكمية"><Plus size={17} /></button></div>
          <button type="button" className="customer-primary-button" disabled={!canAdd} onClick={() => onAdd(variantId, addonIds, qty)}><span>أضف للسلة</span><strong>{formatMoney(unit * qty)}</strong></button>
        </div>
      </div>
    </div>
  );
}
