'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney, formatTime } from '@/lib/domain/misc';
import { isTerminal, type OrderStatus } from '@/lib/domain/order-machine';
import type { TrackingView } from '@/lib/types';

const STEPS: { label: string; reached: (s: OrderStatus) => boolean; active: (s: OrderStatus) => boolean }[] = [
  { label: 'الطلب اتأكد', reached: (s) => ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'CONFIRMED' },
  { label: 'جاري التحضير', reached: (s) => ['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'PREPARING' || s === 'READY' },
  { label: 'خرج للتوصيل', reached: (s) => ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'OUT_FOR_DELIVERY' },
  { label: 'وصل بوابة الجامعة', reached: (s) => ['ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'ARRIVED_AT_GATE' },
];

function mmss(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Server time = local clock + offset measured from API responses (so a wrong phone clock can't break the countdown). */
function useNow(offset: number) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [offset]);
  return now;
}

export function Tracking({ initial, token }: { initial: TrackingView; token: string }) {
  const [view, setView] = useState(initial);
  const [offset, setOffset] = useState(0);
  const [stale, setStale] = useState(false);
  const now = useNow(offset);
  const o = view.order;
  const done = isTerminal(o.status);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const started = Date.now();
    try {
      const res = await fetch(`/api/public/orders/${token}`, { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as TrackingView;
        setOffset(data.serverTime - (started + Date.now()) / 2);
        setView(data);
        setStale(false);
      }
    } catch {
      setStale(true);
    } finally {
      inFlight.current = false;
    }
  }, [token]);

  // Polling sync (the reliable channel): fast while visible, slow in background, stops when finished.
  useEffect(() => {
    setOffset(initial.serverTime - Date.now());
    if (done) return;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await refresh();
      timer = setTimeout(loop, document.visibilityState === 'visible' ? 4000 : 15000);
    };
    timer = setTimeout(loop, 3000);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [done, refresh, initial.serverTime]);

  const inQueue = ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(o.status);
  const remaining = o.estimatedArrivalAt ? o.estimatedArrivalAt - now : null;

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 pb-12">
      <header className="flex items-center justify-between">
        <Link href={`/s/${view.restaurant.slug}`} className="text-sm font-semibold text-orange-700">← {view.restaurant.nameAr}</Link>
        {stale && <span className="badge bg-amber-100 text-amber-800">النت ضعيف…</span>}
      </header>

      <section className="card text-center">
        <div className="text-sm text-gray-500">رقم الطلب</div>
        <div className="text-4xl font-black tracking-wide" dir="ltr">#{o.orderNumber}</div>
        <div className="mt-1 text-xs text-gray-500">احتفظ بالرقم ده — هتقوله للدليفري</div>
      </section>

      {o.status === 'AWAITING_PAYMENT' && view.instapay && <PaymentCard view={view} token={token} now={now} onSubmitted={refresh} />}

      {o.status === 'PAYMENT_REVIEW' && (
        <section className="card border-2 border-amber-300 text-center">
          <div className="text-3xl">⏳</div>
          <div className="mt-1 text-lg font-bold">بنراجع التحويل</div>
          <p className="text-sm text-gray-600">المحل بيتأكد من InstaPay وهيبدأ يحضّر طلبك فورًا.</p>
        </section>
      )}

      {o.status === 'CREATED' && (
        <section className="card border-2 border-amber-300 text-center">
          <div className="text-3xl">📨</div>
          <div className="mt-1 text-lg font-bold">طلبك وصل المحل</div>
          <p className="text-sm text-gray-600">المحل بيأكد الطلب دلوقتي — الدفع كاش عند الاستلام.</p>
        </section>
      )}

      {inQueue && (
        <section className="card bg-gray-900 text-center text-white">
          <div className="text-sm opacity-80">{o.status === 'OUT_FOR_DELIVERY' ? 'الدليفري في الطريق — هيوصل خلال' : 'طلبك هيوصل تقريبًا خلال'}</div>
          {remaining !== null && remaining > 0 ? (
            <div className="my-1 font-mono text-6xl font-black tabular-nums" dir="ltr" aria-live="polite">{mmss(remaining)}</div>
          ) : (
            <div className="my-2 text-2xl font-bold">ثواني ويوصل 🙏</div>
          )}
          {o.estimatedArrivalAt && <div className="text-xs opacity-70">حوالي الساعة {formatTime(o.estimatedArrivalAt, view.restaurant.timezone)}</div>}
        </section>
      )}

      {o.status === 'ARRIVED_AT_GATE' && (
        <section className="card border-2 border-green-400 bg-green-50 text-center">
          <div className="text-4xl">🎉</div>
          <div className="text-xl font-extrabold text-green-800">طلبك وصل {o.deliveryPointName}</div>
          <p className="text-sm text-green-800">قول للدليفري رقم الطلب #{o.orderNumber}{o.paymentMethod === 'CASH' ? ` وادفع ${formatMoney(o.total)}` : ''}</p>
        </section>
      )}

      {o.status === 'COMPLETED' && (
        <section className="card text-center">
          <div className="text-4xl">😋</div>
          <div className="text-xl font-extrabold">تم التسليم — بالهنا والشفا</div>
          <Link href={`/s/${view.restaurant.slug}`} className="btn btn-primary mt-3">اطلب تاني</Link>
        </section>
      )}

      {o.status === 'CANCELLED' && (
        <section className="card border-2 border-red-200 text-center">
          <div className="text-xl font-extrabold text-red-700">الطلب اتلغى</div>
          {o.cancelReason && <p className="text-sm text-gray-600">{o.cancelReason}</p>}
          <Link href={`/s/${view.restaurant.slug}`} className="btn btn-primary mt-3">اطلب من جديد</Link>
        </section>
      )}

      {!['CANCELLED', 'AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'CREATED'].includes(o.status) && (
        <section className="card">
          <ol className="space-y-3">
            {STEPS.map((step) => {
              const reached = step.reached(o.status);
              const active = step.active(o.status);
              return (
                <li key={step.label} className="flex items-center gap-3">
                  <span className={`grid size-7 place-items-center rounded-full text-sm font-bold ${reached ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500'} ${active ? 'ring-4 ring-green-200' : ''}`}>
                    {reached ? '✓' : '○'}
                  </span>
                  <span className={reached ? 'font-semibold' : 'text-gray-500'}>{step.label}</span>
                  {active && o.status === 'READY' && <span className="badge bg-green-100 text-green-800">جاهز وهيخرج حالًا</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="card space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">📍 الاستلام</span><span className="font-semibold">{o.deliveryPointName}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">الدفع</span><span className="font-semibold">{o.paymentMethod === 'INSTAPAY' ? 'InstaPay' : 'كاش عند الاستلام'}{o.paymentStatus === 'PAYMENT_VERIFIED' ? ' ✓' : ''}</span></div>
        <hr className="border-gray-100" />
        {o.items.map((it) => (
          <div key={it.id} className="flex justify-between gap-2">
            <span>
              {it.quantity} × {it.nameAr}
              {it.variantNameAr && <span className="text-gray-500"> ({it.variantNameAr})</span>}
              {it.addons.length > 0 && <span className="block text-xs text-gray-500">+ {it.addons.map((a) => a.nameAr).join('، ')}</span>}
            </span>
            <span>{formatMoney(it.lineTotal)}</span>
          </div>
        ))}
        {o.discountTotal > 0 && <div className="flex justify-between text-green-700"><span>الخصم</span><span>− {formatMoney(o.discountTotal)}</span></div>}
        <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-extrabold"><span>الإجمالي</span><span>{formatMoney(o.total)}</span></div>
      </section>

      {(o.status === 'AWAITING_PAYMENT' || o.status === 'CREATED') && <CancelButton token={token} onDone={refresh} />}
      {view.restaurant.phone && (
        <p className="text-center text-xs text-gray-500">
          محتاج حاجة؟ كلم المحل: <a href={`tel:${view.restaurant.phone}`} className="font-semibold" dir="ltr">{view.restaurant.phone}</a>
        </p>
      )}
    </main>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="truncate font-bold" dir="ltr">{value}</div>
      </div>
      <button
        className="btn btn-secondary btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        {copied ? 'اتنسخ ✓' : 'نسخ'}
      </button>
    </div>
  );
}

async function compressImage(file: File): Promise<{ contentType: 'image/jpeg'; base64: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.75, 0.6, 0.45, 0.3]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 480_000) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { contentType: 'image/jpeg', base64: btoa(bin) };
    }
  }
  throw new Error('too-large');
}

function PaymentCard({ view, token, now, onSubmitted }: { view: TrackingView; token: string; now: number; onSubmitted: () => void }) {
  const o = view.order;
  const ip = view.instapay!;
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadlineLeft = o.paymentDeadlineAt ? o.paymentDeadlineAt - now : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const screenshot = file ? await compressImage(file).catch(() => null) : null;
      if (file && !screenshot) {
        setError('مش قادرين نقرأ الصورة — تقدر تكمّل من غيرها');
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/public/orders/${token}/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reference: reference.trim() || null, screenshot }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
        if (data.error?.code !== 'INVALID_TRANSITION') setError(data.error?.message ?? 'حصلت مشكلة، حاول تاني');
      }
      onSubmitted();
    } catch {
      setError('النت ضعيف — حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3 border-2 border-orange-300">
      <h2 className="text-lg font-extrabold">ادفع بـ InstaPay</h2>
      {o.paymentStatus === 'PAYMENT_REJECTED' && (
        <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">المحل ملقاش التحويل: {o.paymentRejectedReason || 'راجع البيانات وحاول تاني'}</p>
      )}
      <div className="rounded-xl bg-orange-50 p-3 text-center">
        <div className="text-sm text-orange-900">المبلغ المطلوب</div>
        <div className="text-3xl font-black text-orange-700">{formatMoney(o.total)}</div>
      </div>
      {ip.address && <CopyRow label="عنوان InstaPay" value={ip.address} />}
      {ip.phone && <CopyRow label="أو رقم الموبايل" value={ip.phone} />}
      <CopyRow label="اكتب في ملاحظة التحويل" value={`Order #${o.orderNumber}`} />
      {ip.accountName && <p className="text-xs text-gray-500">اسم الحساب: <b dir="ltr">{ip.accountName}</b></p>}
      {ip.instructions && <p className="text-xs text-gray-600">{ip.instructions}</p>}
      {ip.link && (
        <a href={ip.link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full">افتح InstaPay</a>
      )}
      <div>
        <label className="label" htmlFor="ref">رقم العملية (اختياري)</label>
        <input id="ref" className="input" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={64} />
      </div>
      <div>
        <span className="label">صورة التحويل (اختياري)</span>
        <label className="btn btn-secondary w-full cursor-pointer">
          📎 {file ? file.name.slice(0, 28) : 'اختار صورة من الموبايل'}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {error && <p className="text-sm font-semibold text-red-600" role="alert">{error}</p>}
      <button className="btn btn-success btn-lg w-full" disabled={busy} onClick={submit}>{busy ? 'جاري الإرسال…' : 'تم التحويل ✓'}</button>
      {deadlineLeft !== null && deadlineLeft > 0 && (
        <p className="text-center text-xs text-gray-500">لو مفيش تحويل خلال <span dir="ltr" className="font-mono">{mmss(deadlineLeft)}</span> الطلب هيتلغي تلقائيًا</p>
      )}
    </section>
  );
}

function CancelButton({ token, onDone }: { token: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return <button className="btn btn-ghost w-full text-red-600" onClick={() => setConfirming(true)}>إلغاء الطلب</button>;
  }
  return (
    <div className="card flex items-center justify-between gap-2">
      <span className="text-sm font-semibold">متأكد إنك عايز تلغي؟</span>
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>لا</button>
        <button
          className="btn btn-danger btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await fetch(`/api/public/orders/${token}/cancel`, { method: 'POST' }).catch(() => null);
            setBusy(false);
            setConfirming(false);
            onDone();
          }}
        >
          إلغاء الطلب
        </button>
      </div>
    </div>
  );
}
