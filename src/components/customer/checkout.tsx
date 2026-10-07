'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { estimateLine, useCart } from '@/client/cart';
import { fingerprint, uuid } from '@/client/ids';
import { PROFILE_KEY, readJson, rememberOrder, writeJson } from '@/client/storage';
import { formatMoney, normalizeEgyptianPhone } from '@/lib/domain/misc';
import type { PaymentMethod } from '@/lib/domain/order-machine';
import type { PublicMenu, QuoteResponse } from '@/lib/types';

interface ApiError {
  error?: { code: string; message: string };
}

export function Checkout({ menu }: { menu: PublicMenu }) {
  const router = useRouter();
  const slug = menu.restaurant.slug;
  const { lines, setQuantity, clear } = useCart(slug);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(menu.paymentMethods[0]?.method ?? null);
  const defaultPoint = menu.deliveryPoints.find((p) => p.isDefault) ?? menu.deliveryPoints[0];
  const [pointId, setPointId] = useState<string | undefined>(defaultPoint?.id);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accepting = menu.store.status === 'OPEN' || menu.store.status === 'BUSY';

  useEffect(() => {
    const profile = readJson<{ name?: string; phone?: string }>(PROFILE_KEY, {});
    if (profile.name) setName(profile.name);
    if (profile.phone) setPhone(profile.phone);
  }, []);

  const items = useMemo(
    () => lines.map((l) => ({ productId: l.productId, variantId: l.variantId, addonIds: l.addonIds, quantity: l.quantity })),
    [lines],
  );

  // Server-authoritative price quote (debounced).
  useEffect(() => {
    if (!items.length) {
      setQuote(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/public/stores/${slug}/quote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items, promoCode, deliveryPointId: pointId }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as QuoteResponse & ApiError;
        if (!res.ok) {
          setQuote(null);
          setQuoteError(data.error?.message ?? 'تعذر حساب الطلب');
        } else {
          setQuote(data);
          setQuoteError(null);
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setQuoteError('النت ضعيف — بنحاول تاني…');
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [items, promoCode, pointId, slug]);

  const phoneValid = !phone ? !menu.restaurant.requirePhone : !!normalizeEgyptianPhone(phone);
  const canSubmit =
    accepting && !!quote && !quoteError && quote.minOrderShortfall === 0 && name.trim().length >= 2 && phoneValid && !!method && !submitting;

  async function submit() {
    if (!canSubmit || !method) return;
    setSubmitting(true);
    setError(null);
    const payload = {
      items,
      customerName: name.trim(),
      customerPhone: phone.trim() || null,
      note: note.trim() || null,
      paymentMethod: method,
      promoCode,
      deliveryPointId: pointId ?? null,
      source: readJson<string | null>(`utm:${slug}`, null, 'session'),
    };
    // Same payload ⇒ same Idempotency-Key, so a retry after a timeout never creates a second order.
    const hash = fingerprint(JSON.stringify(payload));
    const attemptKey = `checkout-attempt:${slug}`;
    const prev = readJson<{ hash: string; key: string } | null>(attemptKey, null, 'session');
    const key = prev?.hash === hash ? prev.key : uuid();
    writeJson(attemptKey, { hash, key }, 'session');
    writeJson(PROFILE_KEY, { name: payload.customerName, phone: payload.customerPhone ?? '' });

    try {
      const res = await fetch(`/api/public/stores/${slug}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { trackingToken: string; orderNumber: string } & ApiError;
      if (!res.ok) {
        setError(data.error?.message ?? 'حصلت مشكلة، حاول تاني');
        setSubmitting(false);
        return;
      }
      rememberOrder({ token: data.trackingToken, orderNumber: data.orderNumber, slug, createdAt: Date.now() });
      writeJson(attemptKey, null, 'session');
      clear();
      router.replace(`/order/${data.trackingToken}`);
    } catch {
      setError('النت ضعيف — اضغط تأكيد تاني (مش هيتكرر الطلب)');
      setSubmitting(false);
    }
  }

  if (!lines.length) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-5xl">🛒</div>
        <p className="font-semibold">السلة فاضية</p>
        <Link href={`/s/${slug}`} className="btn btn-primary">ارجع للمنيو</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl pb-36">
      <header className="flex items-center gap-3 bg-white px-4 py-4 shadow-sm">
        <Link href={`/s/${slug}`} className="btn btn-ghost btn-sm text-lg" aria-label="رجوع">→</Link>
        <h1 className="text-lg font-extrabold">تأكيد الطلب</h1>
      </header>

      <div className="space-y-4 p-4">
        <section className="card space-y-3">
          <h2 className="font-bold">طلبك</h2>
          {lines.map((l) => {
            const e = estimateLine(menu, l);
            return (
              <div key={l.key} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{e.name}</div>
                  {e.detail && <div className="text-xs text-gray-500">{e.detail}</div>}
                  {!e.available && <div className="text-xs font-semibold text-red-600">غير متاح حاليًا — احذفه</div>}
                </div>
                <div className="flex items-center rounded-xl ring-1 ring-gray-300">
                  <button className="btn btn-ghost btn-sm text-base" onClick={() => setQuantity(l.key, l.quantity + 1)} aria-label="زيادة">+</button>
                  <span className="w-6 text-center font-bold">{l.quantity}</span>
                  <button className="btn btn-ghost btn-sm text-base" onClick={() => setQuantity(l.key, l.quantity - 1)} aria-label="تقليل">−</button>
                </div>
                <div className="w-20 text-end text-sm font-semibold">{formatMoney(e.total)}</div>
              </div>
            );
          })}
        </section>

        <section className="card space-y-3">
          <h2 className="font-bold">بياناتك</h2>
          <div>
            <label className="label" htmlFor="name">الاسم</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} placeholder="اسمك" />
          </div>
          <div>
            <label className="label" htmlFor="phone">رقم الموبايل {menu.restaurant.requirePhone ? '' : '(اختياري)'}</label>
            <input id="phone" className="input" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" maxLength={20} />
            {phone && !phoneValid && <p className="mt-1 text-xs text-red-600">رقم الموبايل غير صحيح</p>}
            <p className="mt-1 text-xs text-gray-500">الدليفري هيكلمك لو احتاج عند البوابة.</p>
          </div>
          <div>
            <label className="label" htmlFor="note">ملاحظة (اختياري)</label>
            <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="مثلاً: من غير بصل" />
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="font-bold">📍 مكان الاستلام</h2>
          {menu.deliveryPoints.length <= 1 ? (
            <div className="rounded-xl bg-orange-50 p-3 font-semibold text-orange-900">{defaultPoint?.nameAr ?? '—'}</div>
          ) : (
            menu.deliveryPoints.map((p) => (
              <label key={p.id} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ${pointId === p.id ? 'bg-orange-50 ring-orange-400' : 'ring-gray-200'}`}>
                <input type="radio" name="point" checked={pointId === p.id} onChange={() => setPointId(p.id)} className="accent-orange-600" />
                {p.nameAr}
              </label>
            ))
          )}
        </section>

        <section className="card space-y-2">
          <h2 className="font-bold">طريقة الدفع</h2>
          {menu.paymentMethods.length === 0 && <p className="text-sm text-red-600">لا توجد طريقة دفع متاحة حاليًا</p>}
          {menu.paymentMethods.map(({ method: m }) => (
            <label key={m} className={`flex items-start gap-3 rounded-xl px-3 py-3 ring-1 ${method === m ? 'bg-orange-50 ring-orange-400' : 'ring-gray-200'}`}>
              <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} className="mt-1 accent-orange-600" />
              <span>
                <span className="font-semibold">{m === 'INSTAPAY' ? 'InstaPay' : 'كاش عند الاستلام'}</span>
                <span className="block text-xs text-gray-500">
                  {m === 'INSTAPAY' ? 'هتحوّل المبلغ بعد تأكيد الطلب وتكتب رقم الطلب في التحويل' : 'ادفع للدليفري عند البوابة'}
                </span>
              </span>
            </label>
          ))}
        </section>

        <section className="card space-y-2">
          <div className="flex gap-2">
            <input className="input" value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} placeholder="كود خصم" dir="ltr" maxLength={32} />
            {promoCode ? (
              <button className="btn btn-secondary" onClick={() => { setPromoCode(null); setPromoInput(''); }}>إزالة</button>
            ) : (
              <button className="btn btn-dark" disabled={!promoInput.trim()} onClick={() => setPromoCode(promoInput.trim())}>تطبيق</button>
            )}
          </div>
          {quote?.promoError && <p className="text-sm text-red-600">{quote.promoError.message}</p>}
          {quote?.promotion && <p className="text-sm text-green-700">✓ {quote.promotion.code ?? quote.promotion.name}</p>}
        </section>

        <section className="card space-y-1.5 text-sm">
          {quote ? (
            <>
              <Row label="المجموع" value={formatMoney(quote.subtotal)} />
              {quote.discount > 0 && <Row label="الخصم" value={`− ${formatMoney(quote.discount)}`} tone="text-green-700" />}
              {quote.deliveryFee > 0 && <Row label="التوصيل" value={formatMoney(quote.deliveryFee)} />}
              <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-extrabold">
                <span>الإجمالي</span>
                <span>{formatMoney(quote.total)}</span>
              </div>
              <p className="pt-1 text-xs text-gray-500">⏱️ الوقت المتوقع للوصول: حوالي {quote.etaMinutes} دقيقة بعد تأكيد الطلب</p>
              {quote.minOrderShortfall > 0 && (
                <p className="text-sm font-semibold text-red-600">الحد الأدنى للطلب {formatMoney(quote.minOrderAmount)} — زوّد {formatMoney(quote.minOrderShortfall)}</p>
              )}
            </>
          ) : quoteError ? (
            <p className="font-semibold text-red-600">{quoteError}</p>
          ) : (
            <div className="space-y-2">
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-6 w-2/3" />
            </div>
          )}
        </section>

        {!accepting && <p className="rounded-xl bg-red-50 p-3 text-center font-semibold text-red-700">{menu.store.status === 'PAUSED' ? 'الطلبات متوقفة مؤقتًا بسبب ضغط الطلبات' : 'المحل مغلق حاليًا'}</p>}
        {error && <p className="rounded-xl bg-red-50 p-3 text-center font-semibold text-red-700" role="alert">{error}</p>}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl bg-gradient-to-t from-[#f6f5f3] via-[#f6f5f3] p-3 pt-6">
        <button className="btn btn-primary btn-lg w-full" disabled={!canSubmit} onClick={submit}>
          {submitting ? 'جاري التأكيد…' : `تأكيد الطلب${quote ? ` • ${formatMoney(quote.total)}` : ''}`}
        </button>
      </div>
    </main>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`flex justify-between ${tone ?? ''}`}>
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
