'use client';

import Link from 'next/link';
import { useLanguage } from '@/components/language-provider';
import { LanguageSwitcher } from '@/components/language-switcher';
import { labels, localizedName } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import { AlarmClock, ArrowLeft, Check, Clock3, MapPin, Minus, Plus, RotateCcw, Search, ShoppingBag, UtensilsCrossed, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { estimateLine, useCart } from '@/client/cart';
import { lastOrderFor, MY_ORDERS_KEY, readJson, writeJson, type SavedOrder } from '@/client/storage';
import { formatMoney } from '@/lib/domain/misc';
import { brandTextColor } from '@/lib/domain/restaurant-brand';
import type { CustomerQuoteResponse, PublicMenu, PublicMenuProduct } from '@/lib/types';
import './customer.css';

const searchable = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي');

export function StoreMenu({ menu: initialMenu, orderAhead }: { menu: PublicMenu; orderAhead?: { ar: string; en: string } }) {
  const { locale, t } = useLanguage();
  const [menu, setMenu] = useState(initialMenu);
  const slug = menu.restaurant.slug;
  const router = useRouter();
  const { lines, add, replace } = useCart(slug);
  const [lastOrder, setLastOrder] = useState<SavedOrder | null>(null);
  const [selected, setSelected] = useState<PublicMenuProduct | null>(null);
  const closeSheet = useCallback(() => setSelected(null), []);
  const [activeOrder, setActiveOrder] = useState<SavedOrder | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [noticeProduct, setNoticeProduct] = useState<PublicMenuProduct | null>(null);
  const notice = noticeProduct ? t('أضفنا ', 'Added ') + localizedName(locale, noticeProduct.nameAr, noticeProduct.nameEn) + t(' للسلة', ' to your basket') : '';
  const accepting = menu.store.status === 'OPEN' || menu.store.status === 'BUSY';
  /** Suspended by the platform: browsing only, no cart. */
  const suspended = menu.store.reason === 'INACTIVE';
  const defaultPoint = menu.deliveryPoints.find((p) => p.isDefault) ?? menu.deliveryPoints[0];
  const cartItems = useMemo(() => lines.map((line) => ({
    productId: line.productId,
    variantId: line.variantId,
    addonIds: line.addonIds,
    quantity: line.quantity,
  })), [lines]);
  // Menu prices are published per component, while the server rounds a whole
  // cart once. Use the public quote for basket figures so unusual piaster
  // prices and quantities never move by a piaster on the checkout screen.
  const basketQuoteKey = JSON.stringify({ items: cartItems, deliveryPointId: defaultPoint?.id ?? null });
  const [basketQuoteState, setBasketQuoteState] = useState<{ key: string; data?: CustomerQuoteResponse } | null>(null);
  const basketQuote = basketQuoteState?.key === basketQuoteKey ? basketQuoteState.data ?? null : null;

  useEffect(() => {
    const utm = new URLSearchParams(window.location.search).get('utm_source');
    if (utm) writeJson('utm:' + slug, utm.slice(0, 64), 'session');
    const recent = readJson<SavedOrder[]>(MY_ORDERS_KEY, []).find((o) => o.slug === slug && Date.now() - o.createdAt < 3 * 3600_000);
    setActiveOrder(recent ?? null);
    setLastOrder(lastOrderFor(slug, new URLSearchParams(window.location.search).get('reorder')));
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
    if (!noticeProduct) return;
    const timer = setTimeout(() => setNoticeProduct(null), 2500);
    return () => clearTimeout(timer);
  }, [noticeProduct]);

  useEffect(() => {
    if (!cartItems.length) {
      setBasketQuoteState(null);
      return;
    }
    const ctrl = new AbortController();
    let disposed = false;
    const refreshQuote = async () => {
      if (document.hidden || !navigator.onLine) return;
      try {
        const res = await fetch('/api/public/stores/' + slug + '/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: cartItems, deliveryPointId: defaultPoint?.id ?? null }),
          signal: ctrl.signal,
        });
        if (!res.ok || disposed) return;
        const data = await res.json() as CustomerQuoteResponse;
        if (!disposed) setBasketQuoteState({ key: basketQuoteKey, data });
      } catch {
        // Checkout retries the authoritative quote and explains any error.
      }
    };
    const timer = setTimeout(refreshQuote, 150);
    const retryTimer = setInterval(refreshQuote, 30_000);
    window.addEventListener('online', refreshQuote);
    document.addEventListener('visibilitychange', refreshQuote);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(retryTimer);
      ctrl.abort();
      window.removeEventListener('online', refreshQuote);
      document.removeEventListener('visibilitychange', refreshQuote);
    };
  }, [cartItems, defaultPoint?.id, slug, basketQuoteKey, menu]);

  const totals = useMemo(() => ({ count: lines.reduce((sum, line) => sum + line.quantity, 0) }), [lines]);
  const basketAmount = !totals.count ? formatMoney(0, locale) : basketQuote ? formatMoney(basketQuote.subtotal, locale) : '…';
  const quotedLineTotal = (line: typeof lines[number], index: number) => {
    const quoted = basketQuote?.lines[index];
    return quoted && quoted.productId === line.productId && quoted.variantId === line.variantId && quoted.quantity === line.quantity
      ? quoted.lineTotal
      : null;
  };

  const byCategory = useMemo(() => menu.categories
    .filter((c) => category === 'all' || c.id === category)
    .map((c) => ({
      ...c,
      products: menu.products.filter((p) => p.categoryId === c.id && searchable(p.nameAr + ' ' + p.nameEn + ' ' + (p.descriptionAr ?? '') + ' ' + (p.descriptionEn ?? '')).includes(searchable(query.trim()))),
    })).filter((c) => c.products.length > 0), [menu, category, query]);
  const totalProducts = byCategory.reduce((sum, c) => sum + c.products.length, 0);
  const categories = menu.categories.filter((c) => menu.products.some((p) => p.categoryId === c.id));
  const heroImage = menu.restaurant.coverImageUrl || menu.banners.find((b) => b.imageUrl)?.imageUrl;
  const brand = menu.restaurant;
  const brandColor = brand.brandColor || '#263c2c';

  const addProduct = (product: PublicMenuProduct, variantId: string | null, addonIds: string[], qty: number) => {
    add(product.id, variantId, addonIds, qty);
    setNoticeProduct(product);
  };
  // "Order it again": only lines that are still valid on today's menu; prices are re-checked by the server.
  const reorderLines = useMemo(() => (lastOrder?.lines ?? []).filter((l) => estimateLine(menu, { ...l, key: '' }, locale).available), [lastOrder, menu, locale]);
  const reorderSummary = reorderLines.map((l) => l.quantity + ' × ' + estimateLine(menu, { ...l, key: '' }, locale).name).join(t("، ", ", "));
  const reorderTotal = reorderLines.reduce((sum, l) => sum + estimateLine(menu, { ...l, key: '' }, locale).total, 0);
  const reorder = useCallback(() => {
    if (!reorderLines.length) return;
    replace(reorderLines);
    router.push('/s/' + slug + '/checkout');
  }, [reorderLines, replace, router, slug]);
  const autoReordered = useRef(false);
  useEffect(() => {
    // Arriving from "اطلب نفس الطلب تاني" on the tracking page.
    if (autoReordered.current || !lastOrder || !accepting) return;
    if (!new URLSearchParams(window.location.search).has('reorder')) return;
    autoReordered.current = true;
    reorder();
  }, [lastOrder, accepting, reorder]);

  const quickAdd = (product: PublicMenuProduct) => {
    if (product.variants.length || product.addonGroupIds.length) setSelected(product);
    else addProduct(product, null, [], 1);
  };

  return (
    <main className="customer-page" style={{ '--customer-brand': brandColor, '--customer-brand-text': brandTextColor(brandColor) } as CSSProperties}>
      <header className="customer-topbar">
        <Link href={'/s/' + slug} className="restaurant-wordmark" aria-label={t("منيو ", "Menu ") + localizedName(locale, menu.restaurant.nameAr, menu.restaurant.nameEn)}>
          <span className="restaurant-mark">
            {menu.restaurant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={menu.restaurant.logoUrl} alt="" width={48} height={48} />
            ) : <UtensilsCrossed size={22} strokeWidth={1.6} />}
          </span>
          <span><strong>{localizedName(locale, menu.restaurant.nameAr, menu.restaurant.nameEn)}</strong><small>{localizedName(locale, brand.badgeText, brand.badgeTextEn) || t("طلب مباشر من المطعم", "Direct from the restaurant")}</small></span>
        </Link>
        <div className="customer-topbar-actions"><LanguageSwitcher /><div className="topbar-status"><span className={'status-dot ' + (accepting ? 'is-open' : 'is-closed')} />{suspended ? t("متوقف مؤقتًا", "Temporarily paused") : labels(locale).storeStatus[menu.store.status]}</div></div>
      </header>

      <div className="store-layout">
        <div className="store-content">
          <section className={'restaurant-hero ' + (heroImage ? 'has-image' : '')} aria-label={t("أهلًا بك", "Welcome")}>
            {heroImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroImage} alt="" fetchPriority="high" decoding="async" className="hero-photo" />
            )}
            <div className="hero-content">
              <span className="hero-eyebrow"><span />{localizedName(locale, brand.badgeText, brand.badgeTextEn) || t("من المطبخ، لحد عندك", "From our kitchen to you")}</span>
              <h1>{localizedName(locale, menu.restaurant.nameAr, menu.restaurant.nameEn)}</h1>
              <p>{localizedName(locale, brand.taglineAr, brand.taglineEn) || t("اختار اللي بتحبه. هنجهّز طلبك، وتتابعه معانا خطوة بخطوة.", "Choose what you love. We prepare it while you follow every step.")}</p>
              <a href="#menu" className="hero-link">{t("اكتشف المنيو ", "Explore the menu ")}<ArrowLeft className="directional-arrow" size={16} /></a>
            </div>
            <div className="hero-caption"><UtensilsCrossed size={16} /><span>{t("اختياراتك، على ذوقك.", "Made your way.")}</span></div>
          </section>

          <div className="store-service-strip">
            <div><span className="service-icon"><Clock3 size={20} /></span><span><small>{t("وقت الوصول المتوقع", "Estimated arrival")}</small><strong>{accepting ? menu.store.etaMinutes + t(" دقيقة تقريبًا", " minutes, approximately") : t("الطلب غير متاح حاليًا", "Ordering is currently unavailable")}</strong></span></div>
            <div><span className="service-icon"><MapPin size={20} /></span><span><small>{t("نقطة الاستلام", "Pickup point")}</small><strong>{localizedName(locale, defaultPoint?.nameAr, defaultPoint?.nameEn) || t("تتحدد عند الطلب", "Choose at checkout")}</strong></span></div>
          </div>

          {accepting && orderAhead && t(orderAhead.ar, orderAhead.en) && <p className="order-ahead mt-4"><AlarmClock size={22} aria-hidden="true" />{t(orderAhead.ar, orderAhead.en)}</p>}

          {!accepting && (
            <div className="customer-alert" role="status">
              <strong>{suspended ? t("الطلب أونلاين من المطعم ده متوقف مؤقتًا", "Online ordering is temporarily unavailable") : menu.store.status === 'PAUSED' ? t("المطبخ بياخد استراحة قصيرة من الطلبات", "The kitchen is taking a short break") : t("المطعم مغلق حاليًا", "The restaurant is currently closed")}</strong>
              <p>{suspended ? t("تقدر تتفرج على المنيو، والطلب هيرجع أول ما الخدمة تشتغل تاني.", "You can browse the menu. Ordering will return when service resumes.") : t("تقدر تختار أكلك وتحفظه في السلة. هنحدّث حالة المطعم تلقائيًا.", "Save your choices in your basket. The restaurant's status updates automatically.")}</p>
            </div>
          )}

          {activeOrder && (
            <Link href={'/order/' + activeOrder.token} className="active-order-link">
              <span className="active-order-icon"><ShoppingBag size={20} /></span>
              <span><small>{t("عندك طلب حديث", "Your recent order")}</small><strong>{t("طلب رقم ", "Order ")}{activeOrder.orderNumber}</strong></span>
              <span className="active-order-action">{t("تابع طلبك ", "Track your order ")}<ArrowLeft className="directional-arrow" size={16} /></span>
            </Link>
          )}

          {lastOrder && reorderLines.length > 0 && accepting && !suspended && (
            <section className="reorder-card" aria-label={t("اطلب نفس طلبك اللي فات", "Order your previous meal again")}>
              <div>
                <small>{t("طلبك اللي فات", "Your last order")}{lastOrder.orderNumber ? ' · ' + lastOrder.orderNumber : ''}</small>
                <strong>{t("نفس الطلب في ثانية؟", "Your usual, in a tap?")}</strong>
                <p>{reorderSummary}</p>
                {reorderLines.length < (lastOrder.lines?.length ?? 0) && <p>{t("بعض الأصناف مش متاحة النهارده واتشالت.", "Some items are unavailable today and have been removed.")}</p>}
              </div>
              <button type="button" className="customer-primary-button" onClick={reorder}><RotateCcw size={16} /><span>{t("اطلبه تاني", "Order again")}</span><strong>{formatMoney(reorderTotal, locale)}</strong></button>
            </section>
          )}

          {menu.banners.length > 0 && (
            <div className="menu-promotions no-scrollbar" role="region" tabIndex={0} aria-label={t("عروض وإعلانات المطعم", "Restaurant offers")}>
              {menu.banners.map((banner, i) => (
                <div key={banner.id} className={'menu-promotion ' + (i % 2 ? 'promotion-olive' : 'promotion-amber')}>
                  <span className="promotion-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <div><strong>{localizedName(locale, banner.titleAr, banner.titleEn)}</strong>{(banner.subtitleAr || banner.subtitleEn) && <p>{localizedName(locale, banner.subtitleAr, banner.subtitleEn)}</p>}</div>
                </div>
              ))}
            </div>
          )}

          <section id="menu" className="menu-section">
            <div className="section-heading"><div><span className="section-eyebrow">{t("اختار وجبتك", "Choose your meal")}</span><h2>{t("المنيو", "Menu")}</h2></div><span>{menu.products.length}{t(menu.products.length === 1 ? " صنف" : " أصناف", menu.products.length === 1 ? " item" : " items")}</span></div>
            <label className="menu-search">
              <Search size={19} /><input aria-label={t("ابحث في المنيو", "Search the menu")} placeholder={t("نفسك في إيه؟ ابحث عن وجبتك…", "What are you craving? Search for your meal…")} value={query} onChange={(e) => setQuery(e.target.value)} />
              {query && <button type="button" onClick={() => setQuery('')} aria-label={t("مسح البحث", "Clear search")}><X size={17} /></button>}
            </label>
            <nav className="category-tabs no-scrollbar" aria-label={t("أقسام المنيو", "Menu categories")}>
              <button type="button" className={category === 'all' ? 'is-active' : ''} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>{t("كل المنيو", "All items")}</button>
              {categories.map((c) => <button type="button" key={c.id} className={category === c.id ? 'is-active' : ''} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{localizedName(locale, c.nameAr, c.nameEn)}</button>)}
            </nav>

            {query && <p className="search-result-count" aria-live="polite">{totalProducts}{t(" نتائج للبحث عن «", " results for “")}{query}{t("»", "”")}</p>}
            {byCategory.length === 0 && (
              <div className="customer-empty"><Search size={32} strokeWidth={1.4} /><h3>{query ? t("ملقيناش الصنف ده", "No matching items") : t("المنيو بيتجهّز", "The menu is coming soon")}</h3><p>{query ? t("جرّب اسم تاني أو شوف كل الاختيارات.", "Try another search or browse all items.") : t("ارجع لنا قريب وشوف الأصناف الجديدة.", "Come back soon for our new dishes.")}</p>{(query || category !== 'all') && <button className="customer-secondary-button" onClick={() => { setQuery(''); setCategory('all'); }}>{t("عرض كل المنيو", "View the full menu")}</button>}</div>
            )}
            {byCategory.map((c) => (
              <section key={c.id} className="product-category" aria-labelledby={'category-' + c.id}>
                <div className="category-heading"><h3 id={'category-' + c.id}>{localizedName(locale, c.nameAr, c.nameEn)}</h3><span>{c.products.length}{t(c.products.length === 1 ? " صنف" : " أصناف", c.products.length === 1 ? " item" : " items")}</span></div>
                <div className="product-grid">
                  {c.products.map((product) => {
                    const inCart = lines.filter((l) => l.productId === product.id).reduce((sum, l) => sum + l.quantity, 0);
                    const availableVariants = product.variants.filter((v) => v.isAvailable);
                    const available = product.isAvailable && (!product.variants.length || availableVariants.length > 0);
                    const minPrice = availableVariants.length ? Math.min(...availableVariants.map((v) => v.price)) : product.basePrice;
                    return (
                      <article key={product.id} className={'menu-product ' + (!available ? 'product-unavailable' : '')}>
                        <button type="button" className="product-image-button" onClick={() => setSelected(product)} aria-label={t("تفاصيل ", "Details for ") + localizedName(locale, product.nameAr, product.nameEn)}>
                          {product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.imageUrl} alt={localizedName(locale, product.nameAr, product.nameEn)} loading="lazy" decoding="async" width={160} height={160} />
                          ) : <span className="product-image-placeholder"><UtensilsCrossed size={32} strokeWidth={1.2} /><small>{localizedName(locale, c.nameAr, c.nameEn)}</small></span>}
                          {inCart > 0 && <span className="product-cart-count"><Check size={12} />{inCart}</span>}
                        </button>
                        <div className="product-info">
                          <button type="button" className="product-name-button" onClick={() => setSelected(product)}><h4>{localizedName(locale, product.nameAr, product.nameEn)}</h4></button>
                          <p>{localizedName(locale, product.descriptionAr, product.descriptionEn) || t("حضّر طلبك بالطريقة اللي بتحبها.", "Make your meal just the way you like it.")}</p>
                          <div className="product-action-row">
                            <strong className="product-price">{product.variants.length > 1 && <small>{t("من ", "From ")}</small>}{formatMoney(minPrice, locale)}</strong>
                            {available && !suspended ? <button className="product-add-button" onClick={() => quickAdd(product)} aria-label={t("إضافة ", "Add ") + localizedName(locale, product.nameAr, product.nameEn) + t(" للسلة", " to your basket")}><Plus size={18} /><span>{t("إضافة", "Add")}</span></button> : <span className="product-unavailable-label">{suspended ? t("الطلب متوقف", "Ordering paused") : t("غير متاح", "Unavailable")}</span>}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </section>
          <footer className="store-footer"><span>{localizedName(locale, menu.restaurant.nameAr, menu.restaurant.nameEn)}</span><p>{t("طلبك مباشر من المطعم. الأسعار والوقت بيتأكدوا قبل تأكيد الطلب.", "Order directly from the restaurant. Prices and timing are checked before you confirm.")}</p>{menu.restaurant.phone && <a href={'tel:' + menu.restaurant.phone}>{t("اتصل بالمطعم", "Call the restaurant")}</a>}</footer>
        </div>

        <aside className="store-sidebar">
          <div className="desktop-basket">
            <div className="basket-heading"><ShoppingBag size={21} /><h2>{t("طلبك، على ذوقك", "Your basket")}</h2><span>{totals.count}</span></div>
            {lines.length ? <div className="basket-preview-lines">{lines.map((line, index) => { const item = estimateLine(menu, line, locale); const total = quotedLineTotal(line, index); return <div key={line.key}><span><b>{line.quantity} × </b>{item.name}</span><strong>{total === null ? '…' : formatMoney(total, locale)}</strong></div>; })}</div> : <div className="basket-empty"><ShoppingBag size={37} strokeWidth={1.2} /><p>{t("كل الحلو بيبدأ باختيار.", "Good food starts with a choice.")}</p><span>{t("ضيف وجبتك المفضلة، والباقي علينا.", "Add your favourite meal. We'll take care of the rest.")}</span></div>}
            <div className="basket-total"><span>{t("قيمة الأصناف", "Items subtotal")}</span><strong>{basketAmount}</strong></div>
            <div className="basket-total"><span>{t("قبل التوصيل والخصم", "Before delivery & discounts")}</span><strong>{basketAmount}</strong></div>
            <Link href={'/s/' + slug + '/checkout'} className={'customer-primary-button ' + (!lines.length ? 'is-disabled' : '')} aria-disabled={!lines.length} tabIndex={lines.length ? 0 : -1}>{t("مراجعة الطلب ", "Review order ")}<ArrowLeft className="directional-arrow" size={17} /></Link>
            <p className="basket-footnote">{t("التوصيل والخصم بيتحسبوا في الخطوة الجاية.", "Delivery and discounts are calculated at checkout.")}</p>
          </div>
          <div className="order-promise"><Clock3 size={21} /><h3>{t("وقتك مهم.", "Your time matters.")}</h3><p>{t("هتعرف وقت الوصول المتوقع قبل ما تأكد، وتتابع تجهيز طلبك لحظة بلحظة.", "See your estimated arrival before confirming, then follow your order as it's prepared.")}</p></div>
        </aside>
      </div>

      <div className={'cart-toast ' + (notice ? 'is-visible' : '')} role="status" aria-live="polite"><Check size={17} />{notice}</div>
      {totals.count > 0 && !suspended && <div className="mobile-cart-bar"><Link href={'/s/' + slug + '/checkout'} className="customer-primary-button"><span className="cart-count">{totals.count}</span><span>{t("مراجعة الطلب", "Review order")}</span><strong>{basketAmount}</strong><ArrowLeft className="directional-arrow" size={18} /></Link></div>}
      {selected && !suspended && <ProductSheet key={selected.id} menu={menu} product={menu.products.find((p) => p.id === selected.id) ?? selected} onClose={closeSheet} onAdd={(v, a, q) => { addProduct(selected, v, a, q); setSelected(null); }} />}
    </main>
  );
}

function ProductSheet({ menu, product, onClose, onAdd }: {
  menu: PublicMenu; product: PublicMenuProduct; onClose: () => void;
  onAdd: (variantId: string | null, addonIds: string[], qty: number) => void;
}) {
  const { locale, t } = useLanguage();
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
  const canAdd = product.isAvailable && (!product.variants.length || !!variant?.isAvailable) && !missingGroup &&
    selectedAddons.length === addonIds.length && selectedAddons.every((a) => a.isAvailable) &&
    groups.every((g) => g.maxSelect === 0 || g.addons.filter((a) => addonIds.includes(a.id)).length <= g.maxSelect);

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
          <div><span className="section-eyebrow">{t("خلّيها على ذوقك", "Make it yours")}</span><h2 id="product-sheet-title">{localizedName(locale, product.nameAr, product.nameEn)}</h2><p id="product-sheet-description">{localizedName(locale, product.descriptionAr, product.descriptionEn) || t("اختار تفاصيل وجبتك والكمية المناسبة.", "Choose your meal options and quantity.")}</p></div>
          <button type="button" className="customer-icon-button" onClick={onClose} aria-label={t("إغلاق تفاصيل المنتج", "Close item details")}><X size={21} /></button>
        </div>
        <div className="product-modal-body">
          {product.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="product-modal-photo" src={product.imageUrl} alt={localizedName(locale, product.nameAr, product.nameEn)} width={640} height={300} />
          )}
          {product.variants.length > 0 && <fieldset className="product-options"><legend>{t("اختار الحجم ", "Choose a size ")}<span>{t("مطلوب", "Required")}</span></legend>{product.variants.map((v) => <label key={v.id} className={'customer-choice ' + (variantId === v.id ? 'is-selected' : '') + (!v.isAvailable ? ' is-unavailable' : '')}><input type="radio" name="product-variant" checked={variantId === v.id} disabled={!v.isAvailable} onChange={() => setVariantId(v.id)} /><span>{localizedName(locale, v.nameAr, v.nameEn)}{!v.isAvailable && <small>{t("غير متاح", "Unavailable")}</small>}</span><strong>{formatMoney(v.price, locale)}</strong></label>)}</fieldset>}
          {groups.map((group) => {
            const count = group.addons.filter((a) => addonIds.includes(a.id)).length;
            return <fieldset className="product-options" key={group.id}><legend>{localizedName(locale, group.nameAr, group.nameEn)}<span>{group.minSelect > 0 ? t("مطلوب · ", "Required · ") + group.minSelect + t(" على الأقل", " minimum") : t("اختياري", "Optional")}{group.maxSelect > 0 ? t(" · لحد ", " · up to ") + group.maxSelect : ''}</span></legend>{group.addons.map((addon) => <label key={addon.id} className={'customer-choice ' + (addonIds.includes(addon.id) ? 'is-selected' : '') + (!addon.isAvailable ? ' is-unavailable' : '')}><input type="checkbox" name={'addon-' + group.id} checked={addonIds.includes(addon.id)} disabled={!addon.isAvailable || (!addonIds.includes(addon.id) && group.maxSelect > 1 && count >= group.maxSelect)} onChange={() => toggleAddon(group.id, addon.id)} /><span>{localizedName(locale, addon.nameAr, addon.nameEn)}{!addon.isAvailable && <small>{t("غير متاح", "Unavailable")}</small>}</span><strong>{addon.price ? '+ ' + formatMoney(addon.price, locale) : t("مجانًا", "Free")}</strong></label>)}</fieldset>;
          })}
          {!product.isAvailable && <p className="customer-alert">{t("الصنف ده غير متاح حاليًا.", "This item is currently unavailable.")}</p>}
          {missingGroup && <p className="option-hint">{t(`اختار ${missingGroup.minSelect} على الأقل من «${localizedName(locale, missingGroup.nameAr, missingGroup.nameEn)}».`, `Choose at least ${missingGroup.minSelect} from “${localizedName(locale, missingGroup.nameAr, missingGroup.nameEn)}”.`)}</p>}
        </div>
        <div className="product-modal-footer">
          <div className="quantity-control"><button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty === 1} aria-label={t("تقليل الكمية", "Decrease quantity")}><Minus size={17} /></button><output aria-label={t("الكمية", "Quantity")}>{qty}</output><button type="button" onClick={() => setQty((q) => Math.min(50, q + 1))} disabled={qty === 50} aria-label={t("زيادة الكمية", "Increase quantity")}><Plus size={17} /></button></div>
          <button type="button" className="customer-primary-button" disabled={!canAdd} onClick={() => onAdd(variantId, addonIds, qty)}><span>{t("أضف للسلة", "Add to basket")}</span><strong>{formatMoney(unit * qty, locale)}</strong></button>
        </div>
      </div>
    </div>
  );
}
