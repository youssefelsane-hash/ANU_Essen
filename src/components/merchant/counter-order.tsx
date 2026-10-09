'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { estimateLine, lineKey, normalizeCart, type CartLine } from '@/client/cart';
import { fingerprint, uuid } from '@/client/ids';
import { deviceId } from '@/client/merchant/engine';
import { counterAttemptAfterRejection, counterAttemptKey, counterAttemptPayload, counterDraftKey, counterRequestBody, parseCounterAttempt, parseCounterDraft, persistCounterAttempt, prepareCounterAttempt, type CounterAttempt } from '@/client/merchant/counter-draft';
import { readJson, removeKey, writeJson } from '@/client/storage';
import { formatMoney } from '@/lib/domain/misc';
import type { PaymentMethod } from '@/lib/domain/order-machine';
import { localizedName } from '@/lib/i18n';
import type { OrderSnapshot, PublicMenu, PublicMenuProduct, QuoteResponse } from '@/lib/types';
import { PrintPortal } from './receipt';

interface Props {
  menu: PublicMenu;
  restaurant: { id: string; nameAr: string; nameEn: string; timezone: string };
  userId: string;
  canPrint: boolean;
}

/**
 * Counter / walk-in ordering for the cashier: big tap targets, no required customer details,
 * pickup at the restaurant preselected. The order goes straight into the kitchen queue.
 */
export function CounterOrder({ menu, restaurant, userId, canPrint }: Props) {
  const { locale, t } = useLanguage();
  const pickupPoint = menu.deliveryPoints.find((p) => p.kind === 'PICKUP');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [category, setCategory] = useState('all');
  const [picking, setPicking] = useState<PublicMenuProduct | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [pointId, setPointId] = useState<string | undefined>((pickupPoint ?? menu.deliveryPoints.find((p) => p.isDefault) ?? menu.deliveryPoints[0])?.id);
  const [payment, setPayment] = useState<PaymentMethod>('CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<OrderSnapshot | null>(null);
  const [quoteState, setQuoteState] = useState<{ key: string; quote?: QuoteResponse; error?: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [printing, setPrinting] = useState<OrderSnapshot | null>(null);
  const [restored, setRestored] = useState(false);
  const [pending, setPending] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const attempt = useRef<CounterAttempt | null>(null);
  const submitting = useRef(false);
  const locked = busy || pending || !restored;
  const draftKey = counterDraftKey(restaurant.id, userId);
  const attemptKey = counterAttemptKey(restaurant.id, userId);
  const suspended = menu.store.reason === 'INACTIVE';

  const products = menu.products.filter((p) => category === 'all' || p.categoryId === category);
  const point = menu.deliveryPoints.find((p) => p.id === pointId);
  const subtotal = lines.reduce((sum, l) => sum + estimateLine(menu, l, locale).total, 0);
  const fee = point && point.kind !== 'PICKUP' ? point.deliveryFee : 0;
  const count = lines.reduce((sum, l) => sum + l.quantity, 0);
  const allAvailable = lines.every((l) => estimateLine(menu, l, locale).available);
  const quoteBody = useMemo(() => ({ restaurantId: restaurant.id, actorUserId: userId, items: lines.map(({ productId, variantId, addonIds, quantity }) => ({ productId, variantId, addonIds, quantity })), deliveryPointId: pointId ?? null }), [lines, pointId, restaurant.id, userId]);
  const quoteKey = fingerprint(JSON.stringify(quoteBody));
  const quote = quoteState?.key === quoteKey ? quoteState.quote : undefined;
  const quoteError = quoteState?.key === quoteKey ? quoteState.error : undefined;
  const savedTotals = pending ? attempt.current?.totals : null;
  useEffect(() => {
    const rawAttempt = readJson<unknown>(attemptKey, null, 'session');
    const savedAttempt = parseCounterAttempt(rawAttempt, restaurant.id, userId);
    const rawDraft = readJson<unknown>(draftKey, null, 'session');
    const draft = parseCounterDraft(rawDraft, restaurant.id, userId);
    if (rawAttempt && !savedAttempt) removeKey(attemptKey, 'session');
    if (rawDraft && !draft) removeKey(draftKey, 'session');
    attempt.current = savedAttempt;
    // The saved request is authoritative while its result is unknown, even if the draft changed.
    if (savedAttempt?.pending || (!draft && savedAttempt)) {
      const payload = counterAttemptPayload(savedAttempt);
      setLines(normalizeCart(payload.items));
      setName(payload.customerName ?? '');
      setPhone(payload.customerPhone ?? '');
      setNote(payload.note ?? '');
      setPayment(payload.paymentMethod);
      setPointId(payload.deliveryPointId ?? undefined);
    } else if (draft) {
      setLines(normalizeCart(draft.items));
      setName(draft.name);
      setPhone(draft.phone);
      setNote(draft.note);
      setPayment(draft.payment);
      setPointId(draft.pointId ?? undefined);
    }
    setPending(!!savedAttempt?.pending);
    setRestored(true);
  }, [attemptKey, draftKey, restaurant.id, userId]);
  useEffect(() => {
    if (!restored) return;
    if (!lines.length && !name && !phone && !note) {
      removeKey(draftKey, 'session');
      return;
    }
    writeJson(draftKey, { restaurantId: restaurant.id, userId, items: lines, name, phone, note, pointId: pointId ?? null, payment }, 'session');
  }, [restored, draftKey, restaurant.id, userId, lines, name, phone, note, pointId, payment]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    if (!restored || pending || !lines.length || !online) return;
    const ctrl = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => ctrl.abort(), 12_000);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/merchant/orders/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(quoteBody), signal: ctrl.signal });
        const data = await response.json();
        if (!ctrl.signal.aborted) setQuoteState(response.ok && data.viewerUserId === userId ? { key: quoteKey, quote: data } : { key: quoteKey, error: data.error?.message || t('سجّل الدخول بنفس الحساب عشان تكمل الطلب.', 'Sign in with the same account to continue the order.') });
      } catch {
        if (!disposed) setQuoteState({ key: quoteKey, error: t('راجع الاتصال وحاول تاني.', 'Check your connection and try again.') });
      } finally { clearTimeout(timeout); }
    }, 200);
    return () => { disposed = true; ctrl.abort(); clearTimeout(timer); clearTimeout(timeout); };
  }, [quoteBody, quoteKey, online, locale, pending, restored, quoteRefresh]);


  const add = (productId: string, variantId: string | null, addonIds: string[], quantity: number) => {
    if (submitting.current || locked) return;
    const key = lineKey(productId, variantId, addonIds);
    setLines((cur) => {
      const existing = cur.find((l) => l.key === key);
      return existing
        ? cur.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, l.quantity + quantity) } : l))
        : [...cur, { key, productId, variantId, addonIds: [...addonIds].sort(), quantity }];
    });
    setDone(null);
  };
  const setQty = (key: string, quantity: number) => {
    if (submitting.current || locked) return;
    setLines((cur) => (quantity <= 0 ? cur.filter((l) => l.key !== key) : cur.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l))));
  };

  const tap = (p: PublicMenuProduct) => {
    if (submitting.current || locked || !p.isAvailable) return;
    if (p.variants.length || p.addonGroupIds.length) setPicking(p);
    else add(p.id, null, [], 1);
  };

  async function submit() {
    const replay = attempt.current?.pending ? attempt.current : null;
    if (submitting.current || !restored || !online || (!replay && (!lines.length || suspended || !allAvailable || !quote))) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError(t('محتاج إنترنت عشان تسجّل طلب جديد. الطلبات اللي على الشاشة شغالة عادي.', 'You need internet to record a new order. Orders already on the board keep working.'));
      return;
    }
    // React state is asynchronous; this guard also blocks a second click in the same render.
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const nextAttempt = replay ?? prepareCounterAttempt(attempt.current, {
        restaurantId: restaurant.id,
        deviceId: deviceId(),
        items: lines.map(({ productId, variantId, addonIds, quantity }) => ({ productId, variantId, addonIds, quantity })),
        customerName: name.trim() || null,
        customerPhone: phone.trim() || null,
        note: note.trim() || null,
        paymentMethod: payment,
        deliveryPointId: pointId ?? null,
      }, userId, uuid, { total: quote!.total, discount: quote!.discount, deliveryFee: quote!.deliveryFee });
      let saved = false;
      try { saved = persistCounterAttempt(nextAttempt, sessionStorage); } catch { /* Browser storage can be blocked. */ }
      if (!saved && !replay) {
        setError(t('المتصفح مش قادر يحفظ الطلب بأمان. اسمح بحفظ بيانات الموقع وجرب تاني.', 'The browser cannot save this order safely. Allow site storage and try again.'));
        return;
      }
      attempt.current = nextAttempt;
      setPending(true);
      setPicking(null);
      const res = await fetch('/api/merchant/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': nextAttempt.key },
        body: counterRequestBody(nextAttempt, userId),
        signal: AbortSignal.timeout(20_000),
      });
      const raw: unknown = await res.json().catch(() => null);
      const data = (raw && typeof raw === 'object' ? raw : {}) as { viewerUserId?: string; order?: OrderSnapshot; error?: { message?: string } };
      if (!res.ok || data.viewerUserId !== userId || !data.order || data.order.restaurantId !== restaurant.id || typeof data.order.id !== 'string' || typeof data.order.orderNumber !== 'string') {
        const rejectedAttempt = counterAttemptAfterRejection(nextAttempt, res.status, !!replay);
        if (!rejectedAttempt.pending) {
          // A definite rejection permits corrections, while unchanged retries keep the original key.
          attempt.current = rejectedAttempt;
          try { persistCounterAttempt(attempt.current, sessionStorage); } catch { /* The in-memory attempt still survives a retry. */ }
          setPending(false);
          setQuoteState(null);
          setQuoteRefresh((value) => value + 1);
        }
        setError(data.error?.message ?? t('تعذر تأكيد النتيجة. اضغط «تأكيد نفس الطلب» للمراجعة الآمنة.', 'Could not confirm the result. Press “Confirm same order” to check safely.'));
        return;
      }
      attempt.current = null;
      removeKey(attemptKey, 'session');
      removeKey(draftKey, 'session');
      setPending(false);
      setDone(data.order);
      setLines([]);
      setName('');
      setPhone('');
      setNote('');
      setPayment('CASH');
      setPointId((pickupPoint ?? point)?.id);
    } catch {
      setError(attempt.current?.pending
        ? t('الاتصال انقطع. اضغط «تأكيد نفس الطلب» عشان تعرف النتيجة من غير تكرار.', 'Connection lost. Press “Confirm same order” to check the result without recording it twice.')
        : t('تعذر تجهيز الطلب. راجع البيانات وجرب تاني.', 'Could not prepare the order. Check the details and try again.'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100dvh-110px)] gap-3 p-3 lg:grid-cols-[1fr_380px]">
      <section className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-extrabold">{t('طلب جديد من الكاشير', 'New counter order')}</h1>
          <a href="/merchant" className="btn btn-secondary btn-sm">{t('رجوع للطلبات', 'Back to orders')}</a>
        </div>
        {suspended && <p className="rounded-xl bg-red-100 p-3 font-semibold text-red-800">{t('الخدمة موقوفة من إدارة المنصة — مينفعش تسجيل طلبات جديدة.', 'Service is suspended by the platform — new orders are disabled.')}</p>}
        <nav className="no-scrollbar flex gap-2 overflow-x-auto" aria-label={t('الأقسام', 'Categories')}>
          <button className={`btn btn-sm shrink-0 ${category === 'all' ? 'btn-dark' : 'btn-secondary'}`} onClick={() => setCategory('all')}>{t('الكل', 'All')}</button>
          {menu.categories.map((c) => (
            <button key={c.id} className={`btn btn-sm shrink-0 ${category === c.id ? 'btn-dark' : 'btn-secondary'}`} onClick={() => setCategory(c.id)}>{localizedName(locale, c.nameAr, c.nameEn)}</button>
          ))}
        </nav>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => {
            const prices = p.variants.filter((v) => v.isAvailable).map((v) => v.price);
            const inCart = lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.quantity, 0);
            return (
              <button
                key={p.id}
                onClick={() => tap(p)}
                disabled={!p.isAvailable || suspended || locked}
                className="relative flex min-h-24 flex-col items-start justify-between rounded-2xl bg-white p-3 text-start shadow-sm ring-1 ring-gray-200 transition active:scale-[.98] disabled:opacity-40"
              >
                <span className="text-base leading-tight font-bold">{localizedName(locale, p.nameAr, p.nameEn)}</span>
                <span className="text-sm font-semibold text-gray-600">
                  {p.isAvailable ? formatMoney(prices.length ? Math.min(...prices) : p.basePrice, locale) : t('غير متاح', 'Unavailable')}
                </span>
                {inCart > 0 && <span className="absolute end-2 top-2 grid size-7 place-items-center rounded-full bg-gray-900 text-sm font-bold text-white">{inCart}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-gray-200 lg:sticky lg:top-3 lg:max-h-[calc(100dvh-130px)] lg:overflow-y-auto">
        {done && (
          <div className="rounded-xl bg-green-50 p-3 ring-1 ring-green-200" role="status">
            <p className="font-bold text-green-900">{done.paymentMethod === 'INSTAPAY' ? t(`طلب #${done.orderNumber} اتسجّل — راجع الدفع من شاشة الطلبات`, `Order #${done.orderNumber} saved — verify payment on the orders screen`) : t(`طلب #${done.orderNumber} اتسجّل واتبعت للمطبخ ✓`, `Order #${done.orderNumber} recorded and sent to the kitchen ✓`)}</p>
            {canPrint && <button className="btn btn-secondary btn-sm mt-2" onClick={() => setPrinting(done)}>🖨️ {t('طباعة الفاتورة', 'Print receipt')}</button>}
          </div>
        )}
        <h2 className="font-bold">{t('الطلب', 'Order')} {count > 0 && <span className="badge bg-gray-100 text-gray-700">{count}</span>}</h2>
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">{t('اضغط على الأصناف عشان تضيفها', 'Tap items to add them')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {lines.map((l) => {
              const e = estimateLine(menu, l, locale);
              return (
                <li key={l.key} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.name}</div>
                    {e.detail && <div className="truncate text-xs text-gray-500">{e.detail}</div>}
                    {!e.available && !pending && <div className="text-xs font-semibold text-red-600">{t('غير متاح — احذفه', 'Unavailable — remove it')}</div>}
                  </div>
                  <div className="flex items-center rounded-lg ring-1 ring-gray-300">
                    <button className="btn btn-ghost btn-sm" disabled={locked} onClick={() => setQty(l.key, l.quantity - 1)} aria-label={t('تقليل', 'Decrease')}>−</button>
                    <span className="w-6 text-center font-bold">{l.quantity}</span>
                    <button className="btn btn-ghost btn-sm" disabled={locked} onClick={() => setQty(l.key, l.quantity + 1)} aria-label={t('زيادة', 'Increase')}>+</button>
                  </div>
                  <span className="w-20 text-end text-sm font-semibold">{formatMoney(e.total, locale)}</span>
                </li>
              );
            })}
          </ul>
        )}

        <fieldset className="space-y-1" disabled={locked}>
          <legend className="label">{t('الاستلام', 'Fulfilment')}</legend>
          <div className="flex flex-wrap gap-2">
            {menu.deliveryPoints.map((p) => (
              <label key={p.id} className={`cursor-pointer rounded-xl px-3 py-2 text-sm ring-1 ${pointId === p.id ? 'bg-gray-900 text-white ring-gray-900' : 'ring-gray-300'}`}>
                <input type="radio" name="counter-point" className="sr-only" checked={pointId === p.id} onChange={() => setPointId(p.id)} />
                {p.kind === 'PICKUP' ? '🏪 ' : '🛵 '}{localizedName(locale, p.nameAr, p.nameEn)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1" disabled={locked}>
          <legend className="label">{t('الدفع', 'Payment')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['CASH', 'INSTAPAY'] as const).map((m) => (
              <label key={m} className={`cursor-pointer rounded-xl px-3 py-2 text-center text-sm font-semibold ring-1 ${payment === m ? 'bg-gray-900 text-white ring-gray-900' : 'ring-gray-300'}`}>
                <input type="radio" name="counter-payment" className="sr-only" checked={payment === m} onChange={() => setPayment(m)} />
                {m === 'CASH' ? t('💵 كاش', '💵 Cash') : t('📲 إنستاباي — مراجعة الدفع', '📲 InstaPay — verify payment')}
              </label>
            ))}
          </div>
        </fieldset>

        <details className="rounded-xl bg-gray-50 p-2">
          <summary className="cursor-pointer text-sm font-semibold">{t('اسم العميل وملاحظة (اختياري)', 'Customer name & note (optional)')}</summary>
          <div className="mt-2 space-y-2">
            <input className="input" disabled={locked} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('الاسم — عشان تناديه', 'Name — to call out')} aria-label={t('اسم العميل', 'Customer name')} />
            <input className="input" disabled={locked} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" aria-label={t('موبايل العميل', 'Customer phone')} />
            <input className="input" disabled={locked} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t('ملاحظة للمطبخ', 'Note for the kitchen')} aria-label={t('ملاحظة', 'Note')} />
          </div>
        </details>

        <div className="mt-auto space-y-2 border-t border-gray-100 pt-3">
          {(savedTotals?.discount ?? quote?.discount ?? 0) > 0 && <div className="flex justify-between text-sm text-green-700"><span>{t('الخصم', 'Discount')}</span><span>−{formatMoney(savedTotals?.discount ?? quote?.discount ?? 0, locale)}</span></div>}
          {(savedTotals?.deliveryFee ?? quote?.deliveryFee ?? fee) > 0 && <div className="flex justify-between text-sm"><span>{t('التوصيل', 'Delivery')}</span><span>{formatMoney(savedTotals?.deliveryFee ?? quote?.deliveryFee ?? fee, locale)}</span></div>}
          <div className="flex justify-between text-lg font-black"><span>{t('الإجمالي', 'Total')}</span><span>{formatMoney(savedTotals?.total ?? quote?.total ?? subtotal + fee, locale)}</span></div>
          {pending && <p className="rounded-lg bg-amber-50 p-2 text-sm font-semibold" role="status">{t('الطلب محفوظ وبنراجع إذا كان اتسجّل. أكّد نفس الطلب قبل أي تعديل عشان ما يتكررش.', 'This order is saved while we check whether it was recorded. Confirm the same order before making changes to avoid a duplicate.')}</p>}
          {quoteError && !pending && <div className="rounded-lg bg-amber-50 p-2 text-sm" role="alert"><p>{quoteError}</p><button className="btn btn-secondary btn-sm mt-2" disabled={busy || !online} onClick={() => { setQuoteState(null); setQuoteRefresh((value) => value + 1); }}>{t('حاول تاني', 'Try again')}</button></div>}
          {!online && <p className="rounded-lg bg-amber-50 p-2 text-sm" role="status">{t('اتصل بالإنترنت لتسجيل طلب جديد.', 'Connect to the internet to record a new order.')}</p>}
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{error}</p>}
          <button className="btn btn-success btn-lg w-full text-lg" disabled={!restored || busy || !online || (!pending && (!lines.length || suspended || !allAvailable || !quote))} onClick={submit}>
            {busy ? t('جاري التأكيد…', 'Confirming…') : pending ? t('تأكيد نفس الطلب', 'Confirm same order') : t('سجّل الطلب وابعته للمطبخ', 'Record & send to kitchen')}
          </button>
          {lines.length > 0 && <button className="btn btn-ghost btn-sm w-full text-red-600" disabled={locked} onClick={() => {
            if (submitting.current || locked) return;
            attempt.current = null;
            removeKey(attemptKey, 'session');
            setLines([]);
            setError(null);
          }}>{t('مسح الطلب', 'Clear order')}</button>}
        </div>
      </aside>

      {picking && !locked && <OptionPicker menu={menu} product={picking} onClose={() => setPicking(null)} onAdd={(v, a, q) => { add(picking.id, v, a, q); setPicking(null); }} />}
      {printing && <PrintPortal order={printing} restaurantName={localizedName(locale, restaurant.nameAr, restaurant.nameEn)} timezone={restaurant.timezone} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function OptionPicker({ menu, product, onClose, onAdd }: { menu: PublicMenu; product: PublicMenuProduct; onClose: () => void; onAdd: (variantId: string | null, addonIds: string[], qty: number) => void }) {
  const { locale, t } = useLanguage();
  const first = product.variants.find((v) => v.isAvailable && v.isDefault) ?? product.variants.find((v) => v.isAvailable);
  const [variantId, setVariantId] = useState<string | null>(first?.id ?? null);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const groups = useMemo(() => menu.addonGroups.filter((g) => product.addonGroupIds.includes(g.id)), [menu, product]);
  const missing = groups.find((g) => g.addons.filter((a) => addonIds.includes(a.id)).length < g.minSelect);
  const toggle = (groupId: string, addonId: string) => {
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={localizedName(locale, product.nameAr, product.nameEn)}>
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-extrabold">{localizedName(locale, product.nameAr, product.nameEn)}</h3>
        {product.variants.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {product.variants.map((v) => (
              <button key={v.id} disabled={!v.isAvailable} onClick={() => setVariantId(v.id)} className={`rounded-xl px-3 py-3 text-sm font-semibold ring-1 disabled:opacity-40 ${variantId === v.id ? 'bg-gray-900 text-white ring-gray-900' : 'ring-gray-300'}`}>
                {localizedName(locale, v.nameAr, v.nameEn)} · {formatMoney(v.price, locale)}
              </button>
            ))}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.id} className="mb-3">
            <div className="label">{localizedName(locale, g.nameAr, g.nameEn)}</div>
            <div className="flex flex-wrap gap-2">
              {g.addons.map((a) => (
                <button key={a.id} disabled={!a.isAvailable} onClick={() => toggle(g.id, a.id)} className={`rounded-xl px-3 py-2 text-sm ring-1 disabled:opacity-40 ${addonIds.includes(a.id) ? 'bg-gray-900 text-white ring-gray-900' : 'ring-gray-300'}`}>
                  {localizedName(locale, a.nameAr, a.nameEn)}{a.price ? ` +${formatMoney(a.price, locale)}` : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex items-center rounded-xl ring-1 ring-gray-300">
            <button className="btn btn-ghost" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={t('تقليل', 'Decrease')}>−</button>
            <span className="w-8 text-center text-lg font-bold">{qty}</span>
            <button className="btn btn-ghost" onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label={t('زيادة', 'Increase')}>+</button>
          </div>
          <button className="btn btn-success btn-lg flex-1" disabled={(product.variants.length > 0 && !variantId) || !!missing} onClick={() => onAdd(variantId, addonIds, qty)}>
            {t('أضف', 'Add')}
          </button>
        </div>
        {missing && <p className="mt-2 text-xs text-red-600">{t(`اختار ${missing.minSelect} على الأقل من ${missing.nameAr}`, `Choose at least ${missing.minSelect} from ${missing.nameEn ?? missing.nameAr}`)}</p>}
      </div>
    </div>
  );
}
