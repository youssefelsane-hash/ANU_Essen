'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CheckCheck, Clock3, LoaderCircle, Minus, Plus, Search, ShoppingBag, Store, Trash2 } from 'lucide-react';
import { estimateLine, lineKey, normalizeCart, type CartLine } from '@/client/cart';
import { fingerprint, uuid } from '@/client/ids';
import { readJson, removeKey, writeJson } from '@/client/storage';
import { useLanguage } from '@/components/language-provider';
import { ProductSheet } from '@/components/customer/store-menu';
import { customerMessage } from '@/components/customer/messages';
import { formatMoney, normalizeEgyptianPhone } from '@/lib/domain/misc';
import { localizedName } from '@/lib/i18n';
import type { PaymentMethod } from '@/lib/domain/order-machine';
import type { PublicMenu, PublicMenuProduct, QuoteResponse } from '@/lib/types';
import './counter-order.css';

interface Draft { lines: CartLine[]; name: string; phone: string; note: string; pointId: string; method: PaymentMethod | null; cashReceived: boolean; }
interface CreatedOrder { orderId: string; orderNumber: string; trackingToken: string; total: number; paymentMethod: PaymentMethod; }
interface QuoteState { key: string; data?: QuoteResponse; error?: string; }
interface Attempt { hash: string; key: string; pending?: boolean; payload?: string; }

/** Counter drafts are isolated from customer profiles and baskets, and from other staff accounts. */
export function CounterOrder({ menu: initialMenu, userId, canReceiveCash }: { menu: PublicMenu; userId: string; canReceiveCash: boolean }) {
  const { locale, t } = useLanguage();
  const [menu, setMenu] = useState(initialMenu);
  const slug = menu.restaurant.slug;
  const draftKey = `counter-draft:v1:${menu.restaurant.id}:${userId}`;
  const attemptKey = `counter-attempt:v1:${menu.restaurant.id}:${userId}`;
  const defaultPoint = menu.deliveryPoints.find((p) => p.fulfillmentType === 'PICKUP') ?? menu.deliveryPoints.find((p) => p.isDefault) ?? menu.deliveryPoints[0];
  const [lines, setLines] = useState<CartLine[]>([]);
  const [pointId, setPointId] = useState(defaultPoint?.id ?? '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod | null>(menu.paymentMethods.find((p) => p.method === 'CASH')?.method ?? menu.paymentMethods[0]?.method ?? null);
  const [cashReceived, setCashReceived] = useState(false);
  const [restored, setRestored] = useState(false);
  const [online, setOnline] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<PublicMenuProduct | null>(null);
  const closeSheet = useCallback(() => setSelected(null), []);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const uncertainRef = useRef(false);
  uncertainRef.current = uncertain;
  const locked = submitting || uncertain;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreatedOrder | null>(null);
  const submissionLock = useRef(false);
  const memoryAttempt = useRef<Attempt | null>(null);
  const point = menu.deliveryPoints.find((p) => p.id === pointId);
  const pickup = point?.fulfillmentType === 'PICKUP';
  const accepting = menu.store.status === 'OPEN' || menu.store.status === 'BUSY';
  const items = useMemo(() => lines.map(({ productId, variantId, addonIds, quantity }) => ({ productId, variantId, addonIds, quantity })), [lines]);
  const requestKey = fingerprint(JSON.stringify({ items, pointId, refreshVersion }));
  const quote = quoteState?.key === requestKey ? quoteState.data : undefined;
  const quoteError = quoteState?.key === requestKey ? quoteState.error : undefined;

  useEffect(() => {
    const draft = readJson<Partial<Draft> | null>(draftKey, null, 'session');
    if (draft && typeof draft === 'object') {
      setLines(normalizeCart(draft.lines));
      if (typeof draft.name === 'string') setName(draft.name.slice(0, 60));
      if (typeof draft.phone === 'string') setPhone(draft.phone.slice(0, 20));
      if (typeof draft.note === 'string') setNote(draft.note.slice(0, 300));
      if (menu.deliveryPoints.some((p) => p.id === draft.pointId)) setPointId(draft.pointId!);
      if (menu.paymentMethods.some((p) => p.method === draft.method)) setMethod(draft.method!);
      setCashReceived(canReceiveCash && draft.cashReceived === true);
    }
    const attempt = readJson<Attempt | null>(attemptKey, null, 'session');
    memoryAttempt.current = attempt;
    if (attempt?.pending === true) {
      setUncertain(true);
      // Keep the attempted destination even if today's menu no longer lists it.
      if (typeof draft?.pointId === 'string') setPointId(draft.pointId);
      if (draft?.method === 'CASH' || draft?.method === 'INSTAPAY') setMethod(draft.method);
    }
    setOnline(navigator.onLine);
    setRestored(true);
  }, [draftKey]);

  useEffect(() => {
    if (!restored || success) return;
    writeJson(draftKey, { lines, name, phone, note, pointId, method, cashReceived } satisfies Draft, 'session');
  }, [restored, success, draftKey, lines, name, phone, note, pointId, method, cashReceived]);

  useEffect(() => {
    const ctrl = new AbortController();
    const refresh = async () => {
      if (document.hidden || !navigator.onLine || submissionLock.current) return;
      try {
        const res = await fetch('/api/public/stores/' + slug, { cache: 'no-store', signal: ctrl.signal });
        if (res.ok) {
          const latest = await res.json() as PublicMenu;
          setMenu(latest);
          if (!uncertainRef.current) {
            setMethod((current) => latest.paymentMethods.some((p) => p.method === current) ? current : latest.paymentMethods.find((p) => p.method === 'CASH')?.method ?? latest.paymentMethods[0]?.method ?? null);
            setPointId((current) => latest.deliveryPoints.some((p) => p.id === current) ? current : (latest.deliveryPoints.find((p) => p.fulfillmentType === 'PICKUP') ?? latest.deliveryPoints.find((p) => p.isDefault) ?? latest.deliveryPoints[0])?.id ?? '');
          }
        }
      } catch { /* Keep the last menu. The server rechecks each submission. */ }
      if (!ctrl.signal.aborted) setRefreshVersion((v) => v + 1);
    };
    const onOnline = () => { setOnline(true); void refresh(); };
    const onOffline = () => setOnline(false);
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { ctrl.abort(); clearInterval(timer); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [slug]);

  useEffect(() => {
    if (!items.length || !pointId) return;
    const ctrl = new AbortController();
    let disposed = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/public/stores/' + slug + '/quote', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items, deliveryPointId: pointId }),
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(12_000)]),
        });
        const data = await res.json() as QuoteResponse & { error?: { message: string } };
        if (!disposed) setQuoteState(res.ok ? { key: requestKey, data } : { key: requestKey, error: data.error?.message ?? t('تعذر حساب الطلب.', 'Could not calculate the order.') });
      } catch { if (!disposed) setQuoteState({ key: requestKey, error: t('الاتصال غير مستقر. حدّث حساب الطلب.', 'The connection is unstable. Refresh the order total.') }); }
    }, 200);
    return () => { disposed = true; clearTimeout(timer); ctrl.abort(); };
  }, [items, pointId, slug, requestKey]);

  const phoneValid = phone.trim() ? !!normalizeEgyptianPhone(phone) : pickup || !menu.restaurant.requirePhone;
  const nameValid = !name.trim() || name.trim().length >= 2;
  const allAvailable = lines.every((line) => estimateLine(menu, line, locale).available);
  const canSubmit = restored && online && !submitting && !!method && lines.length > 0 && (uncertain || (accepting && allAvailable && !!point && nameValid && phoneValid && !!quote && quote.minOrderShortfall === 0));
  const hint = !online ? t('اتصل بالإنترنت لحفظ الطلب. اختياراتك محفوظة في الشاشة دي.', 'Connect to the internet to save the order. Your choices are saved in this tab.') : !accepting ? t('الطلبات الجديدة متوقفة حاليًا. افتح استقبال الطلبات أولًا.', 'New orders are paused. Open ordering before creating an order.') : !lines.length ? t('اضغط على الأصناف لإضافتها للطلب.', 'Tap items to add them to the order.') : !allAvailable ? t('احذف الأصناف غير المتاحة أو عدّل اختياراتها.', 'Remove unavailable items or update their options.') : !point ? t('اختار مكان الاستلام.', 'Choose where to collect.') : !method ? t('فعّل طريقة دفع للمطعم أولًا.', 'Enable a payment method first.') : !phoneValid ? t('اكتب رقم موبايل مصري صحيح للطلب.', 'Enter a valid Egyptian mobile number.') : !nameValid ? t('اكتب اسم من حرفين على الأقل، أو اتركه فاضيًا.', 'Use at least two characters for the name, or leave it empty.') : quote?.minOrderShortfall ? t('زوّد الطلب للوصول للحد الأدنى.', 'Add items to reach the minimum order.') : quoteError ? t('حدّث حساب الطلب قبل الحفظ.', 'Refresh the order total before saving.') : !quote ? t('بنراجع السعر والوقت…', 'Checking price and timing…') : '';

  const addProduct = (product: PublicMenuProduct, variantId: string | null, addonIds: string[], quantity: number) => {
    const key = lineKey(product.id, variantId, addonIds);
    setLines((current) => normalizeCart([...current, { key, productId: product.id, variantId, addonIds, quantity }]));
  };
  const changeQuantity = (key: string, quantity: number) => setLines((current) => quantity <= 0 ? current.filter((l) => l.key !== key) : current.map((l) => l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l));
  const quickAdd = (product: PublicMenuProduct) => {
    if (product.variants.length || product.addonGroupIds.length) setSelected(product);
    else addProduct(product, null, [], 1);
  };
  const filtered = menu.products.filter((p) => (category === 'all' || p.categoryId === category) && (p.nameAr + ' ' + p.nameEn).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  async function submit() {
    if (!canSubmit || !method || submissionLock.current) return;
    submissionLock.current = true;
    setSubmitting(true);
    setError(null);
    const payload = { restaurantId: menu.restaurant.id, items, customerName: name.trim() || undefined, customerPhone: phone.trim() || null, note: note.trim() || null, deliveryPointId: pointId, paymentMethod: method, cashReceived: method === 'CASH' && canReceiveCash && cashReceived };
    const previous = memoryAttempt.current ?? readJson<Attempt | null>(attemptKey, null, 'session');
    const payloadText = uncertain && previous?.pending === true && typeof previous.payload === 'string' ? previous.payload : JSON.stringify(payload);
    const hash = fingerprint(payloadText);
    const key = previous?.hash === hash && typeof previous.key === 'string' ? previous.key : uuid();
    memoryAttempt.current = { hash, key, pending: true, payload: payloadText };
    writeJson(attemptKey, memoryAttempt.current, 'session');
    try {
      const res = await fetch('/api/merchant/orders', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: payloadText, signal: AbortSignal.timeout(20_000), credentials: 'same-origin' });
      if (res.status >= 500) throw new Error('uncertain-server-reply');
      const data = await res.json() as CreatedOrder & { error?: { message: string } };
      if (!res.ok) { setUncertain(false); memoryAttempt.current = { hash, key, pending: false, payload: payloadText }; writeJson(attemptKey, memoryAttempt.current, 'session'); setError(data.error?.message ?? t('تعذر حفظ الطلب. حاول مرة أخرى.', 'Could not save the order. Try again.')); setRefreshVersion((v) => v + 1); return; }
      setUncertain(false);
      setSuccess(data);
      memoryAttempt.current = null;
      setLines([]);
      removeKey(attemptKey, 'session');
      removeKey(draftKey, 'session');
    } catch { setUncertain(true); setError(t('الرد موصلناش بسبب الاتصال. اضغط حفظ مرة تانية بنفس الاختيارات؛ الطلب مش هيتكرر.', 'The connection dropped before a reply. Save again with the same choices; the order will not be duplicated.')); }
    finally { submissionLock.current = false; setSubmitting(false); }
  }

  if (success) return <main className="counter-page"><section className="card mx-auto max-w-lg space-y-5 p-8 text-center" role="status"><CheckCheck className="mx-auto text-green-700" size={48} /><h1 className="text-2xl font-black">{t('الطلب اتسجّل', 'Order saved')}</h1><p className="text-4xl font-black" dir="ltr">#{success.orderNumber}</p><p className="font-semibold">{formatMoney(success.total, locale)}</p><p>{success.paymentMethod === 'CASH' ? t('الطلب وصل للمطبخ وبدأ حساب وقت التجهيز.', 'The kitchen has the order and the preparation timer has started.') : t('الطلب في انتظار التحويل. تأكيد الدفع يتم بعد مراجعته فقط.', 'The order is waiting for a transfer. Payment is confirmed only after review.')}</p><button className="btn btn-primary btn-lg w-full" onClick={() => { setSuccess(null); setName(''); setPhone(''); setNote(''); setCashReceived(false); setPointId(defaultPoint?.id ?? ''); setError(null); setQuoteState(null); }}>{t('طلب جديد', 'New order')}</button><div className="flex flex-wrap justify-center gap-3"><Link className="btn btn-secondary" href="/merchant">{t('شاشة الطلبات', 'Order screen')}</Link><Link className="btn btn-secondary" href={'/merchant/orders/' + success.orderId}>{t('تفاصيل وطباعة', 'Details & print')}</Link>{success.paymentMethod === 'INSTAPAY' && <Link className="btn btn-secondary" href={'/order/' + success.trackingToken}>{t('بيانات الدفع ومتابعة العميل', 'Customer payment & tracking')}</Link>}</div></section></main>;

  return <main className="counter-page">
    <header className="mb-5 flex flex-wrap items-center gap-3"><Store className="text-green-800" size={28} /><div><h1 className="text-2xl font-black">{t('طلب من الكاشير', 'Counter order')}</h1><p className="mt-1 text-sm text-gray-600">{t('اختار الأصناف، حدّد الاستلام، واحفظ الطلب للمطبخ.', 'Choose items, select collection, and save the order for the kitchen.')}</p></div></header>
    <div className="counter-layout">
      <section className="min-w-0 space-y-4" aria-label={t('اختيار الأصناف', 'Choose items')}>
        <label className="counter-search"><Search size={20} /><input aria-label={t('ابحث عن صنف', 'Search items')} placeholder={t('ابحث عن صنف…', 'Search items…')} value={search} onChange={(e) => setSearch(e.target.value)} disabled={locked} /></label>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" aria-label={t('أقسام المنيو', 'Menu categories')}><button type="button" className={'btn btn-sm shrink-0 ' + (category === 'all' ? 'btn-dark' : 'btn-secondary')} aria-pressed={category === 'all'} disabled={locked} onClick={() => setCategory('all')}>{t('كل الأصناف', 'All items')}</button>{menu.categories.map((c) => <button type="button" key={c.id} className={'btn btn-sm shrink-0 ' + (category === c.id ? 'btn-dark' : 'btn-secondary')} aria-pressed={category === c.id} disabled={locked} onClick={() => setCategory(c.id)}>{localizedName(locale, c.nameAr, c.nameEn)}</button>)}</div>
        <div className="counter-products">{filtered.map((product) => {
          const variants = product.variants.filter((v) => v.isAvailable);
          const available = product.isAvailable && (!product.variants.length || variants.length > 0);
          const count = lines.filter((l) => l.productId === product.id).reduce((sum, l) => sum + l.quantity, 0);
          return <button type="button" key={product.id} className="counter-product" disabled={!available || locked || !restored} onClick={() => quickAdd(product)} aria-label={t('إضافة ', 'Add ') + localizedName(locale, product.nameAr, product.nameEn)}><span className="counter-product-top"><strong>{localizedName(locale, product.nameAr, product.nameEn)}</strong>{count > 0 && <b className="counter-product-count">{count}</b>}</span><span className="counter-product-bottom"><b>{variants.length > 0 ? (variants.length > 1 ? t('من ', 'From ') : '') + formatMoney(Math.min(...variants.map((v) => v.price)), locale) : formatMoney(product.basePrice, locale)}</b><span>{available ? <Plus size={20} /> : t('غير متاح', 'Unavailable')}</span></span></button>;
        })}</div>
        {!filtered.length && <p className="card text-center text-gray-500">{t('مفيش أصناف مطابقة للبحث.', 'No items match your search.')}</p>}
      </section>
      <section className="counter-basket card" aria-label={t('الطلب الجديد', 'New order')}>
        <h2 className="mb-3 flex items-center gap-2 text-xl font-black"><ShoppingBag size={22} />{t('الطلب الجديد', 'New order')}<span className="badge bg-gray-100">{lines.reduce((sum, l) => sum + l.quantity, 0)}</span></h2>
        <div className="counter-lines">{lines.map((line) => { const item = estimateLine(menu, line, locale); return <div className={'counter-line ' + (!item.available ? 'counter-line-unavailable' : '')} key={line.key}><div className="flex justify-between gap-2"><div><strong>{item.name}</strong>{item.detail && <small className="block text-gray-500">{item.detail}</small>}{!item.available && <small className="block text-red-700">{t('غير متاح — احذفه قبل الحفظ', 'Unavailable — remove before saving')}</small>}</div><b className="shrink-0">{formatMoney(item.total, locale)}</b></div><div className="mt-2 flex items-center gap-2"><button className="counter-quantity" aria-label={t('تقليل كمية ', 'Decrease quantity of ') + item.name} disabled={locked} onClick={() => changeQuantity(line.key, line.quantity - 1)}><Minus size={16} /></button><output className="min-w-6 text-center font-bold" aria-label={t('الكمية', 'Quantity')}>{line.quantity}</output><button className="counter-quantity" aria-label={t('زيادة كمية ', 'Increase quantity of ') + item.name} disabled={locked || line.quantity === 50} onClick={() => changeQuantity(line.key, line.quantity + 1)}><Plus size={16} /></button><button className="ms-auto rounded-lg p-2 text-gray-500" aria-label={t('حذف ', 'Remove ') + item.name} disabled={locked} onClick={() => changeQuantity(line.key, 0)}><Trash2 size={17} /></button></div></div>; })}{!lines.length && <p className="py-4 text-center text-sm text-gray-500">{t('ضيف الأصناف من المنيو.', 'Add items from the menu.')}</p>}</div>
        <fieldset className="mt-4 space-y-2"><legend className="mb-2 font-bold">{t('الاستلام فين؟', 'Where to collect?')}</legend>{menu.deliveryPoints.map((p) => <label key={p.id} className={'counter-choice ' + (pointId === p.id ? 'is-selected' : '')}><input type="radio" name="counter-point" checked={pointId === p.id} disabled={locked} onChange={() => setPointId(p.id)} /><span>{localizedName(locale, p.nameAr, p.nameEn)}<small>{p.fulfillmentType === 'PICKUP' ? t('استلام من المحل · بدون توصيل', 'Collect at the restaurant · no delivery') : t('توصيل لنقطة الاستلام', 'Delivery to collection point')}</small></span></label>)}</fieldset>
        <details className="mt-4"><summary className="cursor-pointer py-2 font-semibold">{t('اسم العميل وملاحظة', 'Customer name & note')}{!pickup && menu.restaurant.requirePhone ? t(' · الموبايل مطلوب', ' · mobile required') : t(' · اختياري', ' · optional')}</summary><div className="mt-2 space-y-3"><label className="block"><span className="label">{t('اسم العميل', 'Customer name')}</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('عميل المحل', 'Walk-in customer')} maxLength={60} disabled={locked} /></label>{(pickup || !menu.restaurant.requirePhone) && <label className="block"><span className="label">{t('رقم الموبايل', 'Mobile number')}</span><input className="input" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} disabled={locked} /></label>}<label className="block"><span className="label">{t('ملاحظة للمطبخ', 'Kitchen note')}</span><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} disabled={locked} /></label></div></details>
        {!pickup && menu.restaurant.requirePhone && <label className="mt-3 block"><span className="label">{t('رقم الموبايل للتوصيل · مطلوب', 'Delivery mobile number · required')}</span><input className="input" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} disabled={locked} /></label>}
        <fieldset className="mt-4 space-y-2"><legend className="mb-2 font-bold">{t('الدفع', 'Payment')}</legend>{menu.paymentMethods.map((p) => <label key={p.method} className={'counter-choice ' + (method === p.method ? 'is-selected' : '')}><input type="radio" name="counter-payment" checked={method === p.method} disabled={locked} onChange={() => { setMethod(p.method); setCashReceived(false); }} /><span>{p.method === 'CASH' ? t('كاش', 'Cash') : t('إنستاباي', 'InstaPay')}<small>{p.method === 'CASH' ? t('يُحصّل عند الاستلام، إلا لو استلمته بالفعل.', 'Collect on pickup, unless already received.') : t('التحضير يبدأ بعد مراجعة التحويل.', 'Preparation starts after transfer review.')}</small></span></label>)}</fieldset>
        {method === 'CASH' && canReceiveCash && <label className="counter-choice mt-2 bg-amber-50"><input type="checkbox" checked={cashReceived} disabled={locked} onChange={(e) => setCashReceived(e.target.checked)} /><Banknote size={20} /><span>{t('استلمت الكاش بالفعل', 'Cash already received')}<small>{t('علّم عليها فقط بعد استلام المبلغ.', 'Check only after receiving the money.')}</small></span></label>}
        <div className="mt-4 border-t border-gray-200 pt-4">{quote ? <><div className="mb-2 flex items-center gap-2 text-sm text-gray-600"><Clock3 size={17} />{pickup ? t('جاهز خلال ', 'Ready in ') : t('وصول خلال ', 'Arrival in ')}{quote.etaMinutes}{t(' دقيقة تقريبًا', ' minutes, approximately')}</div>{quote.discount > 0 && <div className="flex justify-between text-sm text-green-700"><span>{t('خصم تلقائي', 'Automatic discount')}</span><span>−{formatMoney(quote.discount, locale)}</span></div>}{quote.deliveryFee > 0 && <div className="flex justify-between text-sm"><span>{t('رسوم التوصيل', 'Delivery fee')}</span><span>{formatMoney(quote.deliveryFee, locale)}</span></div>}<div className="mb-4 flex justify-between text-2xl font-black"><span>{t('الإجمالي', 'Total')}</span><span>{formatMoney(quote.total, locale)}</span></div></> : lines.length > 0 && !quoteError ? <p className="mb-3 text-sm text-gray-500" role="status">{t('بنراجع السعر والوقت…', 'Checking price and timing…')}</p> : null}
          {quoteError && <div className="mb-3 text-sm text-red-700" role="alert"><p>{customerMessage(quoteError, locale)}</p><button className="btn btn-secondary btn-sm mt-2" disabled={locked} onClick={() => setRefreshVersion((v) => v + 1)}>{t('تحديث حساب الطلب', 'Refresh total')}</button></div>}
          {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{customerMessage(error, locale)}</p>}
          <button className="btn btn-primary btn-lg w-full text-lg" disabled={!canSubmit} onClick={submit}>{submitting ? <><LoaderCircle size={20} className="animate-spin" />{t('بنحفظ الطلب…', 'Saving order…')}</> : uncertain ? t('تأكيد حالة الطلب بدون تكرار', 'Check order without duplicating') : t('حفظ الطلب للمطبخ', 'Save order for kitchen')}</button>
          {uncertain && <p className="mt-3 text-sm text-amber-800" role="status">{t('بنراجع المحاولة السابقة قبل تعديل الطلب. اضغط الزر للتأكد هل اتسجل.', 'Resolve the previous attempt before changing the order. Tap the button to check whether it was saved.')}</p>}{hint && !uncertain && <p className="mt-3 text-sm text-gray-600" role="status">{hint}</p>}
        </div>
      </section>
    </div>
    {selected && <ProductSheet key={selected.id} menu={menu} product={menu.products.find((p) => p.id === selected.id) ?? selected} onClose={closeSheet} onAdd={(v, a, q) => { addProduct(selected, v, a, q); setSelected(null); }} />}
  </main>;
}
