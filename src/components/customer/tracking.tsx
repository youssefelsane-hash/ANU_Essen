'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock3, Check, ChefHat, Bike, MapPin, ShoppingBag, Copy, CheckCheck, RefreshCw, Phone, UtensilsCrossed, AlertCircle, X, Paperclip } from 'lucide-react';
import './tracking.css';
import { formatMoney, formatTime } from '@/lib/domain/misc';
import { isTerminal, type OrderStatus } from '@/lib/domain/order-machine';
import type { TrackingView } from '@/lib/types';

const STEPS: { label: string; reached: (s: OrderStatus) => boolean; active: (s: OrderStatus) => boolean }[] = [
  { label: 'الطلب اتأكد', reached: (s) => ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'CONFIRMED' },
  { label: 'جاري التحضير', reached: (s) => ['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'PREPARING' || s === 'READY' },
  { label: 'خرج للتوصيل', reached: (s) => ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'OUT_FOR_DELIVERY' },
  { label: 'وصل لنقطة الاستلام', reached: (s) => ['ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'ARRIVED_AT_GATE' },
];

function mmss(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Server time = local clock + offset measured from API responses (so a wrong phone clock can't break the countdown). */
function useNow(offset: number, initialServerTime: number) {
  const [now, setNow] = useState(initialServerTime);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [offset]);
  return now;
}

export function Tracking({ initial, token }: { initial: TrackingView; token: string }) {
  const [view, setView] = useState(initial);
  const [offset, setOffset] = useState(() => initial.serverTime - Date.now());
  const [stale, setStale] = useState(false);
  const now = useNow(offset, initial.serverTime);
  const o = view.order;
  const done = isTerminal(o.status);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const started = Date.now();
    try {
      const res = await fetch(`/api/public/orders/${token}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = (await res.json()) as TrackingView;
        setOffset(data.serverTime - (started + Date.now()) / 2);
        setView(data);
        setStale(false);
      } else {
        setStale(true);
      }
    } catch {
      setStale(true);
    } finally {
      inFlight.current = false;
    }
  }, [token]);

  // Polling sync (the reliable channel): fast while visible, slow in background, stops when finished.
  useEffect(() => {
    if (done) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const loop = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(loop, document.visibilityState === 'visible' ? 4000 : 15000);
    };
    timer = setTimeout(loop, 3000);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [done, refresh, initial.serverTime]);

  const inQueue = ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(o.status);
  const remaining = o.estimatedArrivalAt ? o.estimatedArrivalAt - now : null;

  const provisional = ['CREATED', 'AWAITING_PAYMENT', 'PAYMENT_REVIEW'].includes(o.status);
  const stepIcons = [CheckCheck, ChefHat, Bike, MapPin];
  const activeStep = o.status === 'COMPLETED' ? 4 : Math.max(0, STEPS.findIndex((step) => step.active(o.status)));
  const stateLabel = o.status === 'CREATED' ? 'في انتظار تأكيد المطعم' : o.status === 'PAYMENT_REVIEW' ? 'بنراجع التحويل' : o.status === 'AWAITING_PAYMENT' ? 'في انتظار الدفع' : o.status === 'CONFIRMED' ? 'المطعم أكد طلبك' : o.status === 'PREPARING' ? 'أكلك بيتحضّر' : o.status === 'READY' ? 'طلبك جاهز للتوصيل' : o.status === 'OUT_FOR_DELIVERY' ? 'طلبك في الطريق' : o.status === 'ARRIVED_AT_GATE' ? 'طلبك وصل' : o.status === 'COMPLETED' ? 'بالهنا والشفا' : 'الطلب اتلغى';

  return (
    <main className="tracking-page">
      <header className="tracking-header">
        <Link href={`/s/${view.restaurant.slug}`}><ArrowRight size={18} /> {view.restaurant.nameAr}</Link>
        <span><span className={`tracking-dot ${stale ? 'is-stale' : ''}`} />{stale ? 'الاتصال ضعيف' : done ? 'اكتمل التحديث' : 'متابعة مباشرة'}</span>
      </header>
      {stale && <div className="tracking-warning" role="status"><AlertCircle size={17} /><span>بنعرض آخر تحديث وصلنا. الوقت والحالة ممكن يتغيروا عند رجوع الاتصال.</span><button onClick={refresh} aria-label="تحديث الطلب"><RefreshCw size={17} /></button></div>}
      <div className="tracking-layout">
      <div className="tracking-primary">
      <section className="tracking-order-head">
        <span className="tracking-eyebrow">طلبك في أيدينا</span>
        <h1>{stateLabel}</h1>
        <div className="tracking-number"><span>رقم طلبك</span><strong dir="ltr">#{o.orderNumber}</strong><CopyRow label="رقم الطلب" value={o.orderNumber} compact /></div>
        <p>احتفظ بالرقم لاستلام طلبك بسهولة.</p>
      </section>

      {(inQueue || (provisional && o.estimatedArrivalAt)) && <section className={`tracking-eta ${provisional ? 'is-provisional' : ''}`}>
        <div className="tracking-eta-label"><Clock3 size={18} />{provisional ? 'الوقت المتوقع بعد التأكيد' : o.status === 'OUT_FOR_DELIVERY' ? 'متوقع يوصل خلال' : 'متوقع تستلم خلال'}</div>
        {provisional ? <><strong className="tracking-eta-provisional">حوالي {Math.max(1, Math.ceil(((o.estimatedArrivalAt ?? now) - o.createdAt) / 60000))} دقيقة</strong><p>بيبدأ التحضير بعد {o.paymentMethod === 'INSTAPAY' ? 'تأكيد التحويل' : 'قبول المطعم للطلب'}، والوقت بيتحدّث حسب ضغط المطبخ.</p></> : remaining !== null && remaining > 0 ? <>
          <div className="tracking-countdown" dir="ltr" aria-label="الوقت المتبقي تقريبًا">{mmss(remaining)}</div>
          <p>وقت الاستلام المتوقع <strong>{formatTime(o.estimatedArrivalAt!, view.restaurant.timezone)}</strong></p>
        </> : <><strong className="tracking-eta-provisional">بننتظر تحديث المطعم</strong><p>الطلب اتأخر عن الوقت المتوقع. هنحدّث الحالة أول ما المطعم يحدّثها.</p></>}
        {!provisional && <div className="tracking-eta-foot">الوقت تقديري وبيتحدّث مع حالة طلبك</div>}
      </section>}

      {o.status === 'AWAITING_PAYMENT' && view.instapay && <PaymentCard view={view} token={token} now={now} onSubmitted={refresh} />}
      {o.status === 'PAYMENT_REVIEW' && <section className="tracking-state-card"><div className="tracking-state-icon"><Clock3 size={23} /></div><div><h2>التحويل تحت المراجعة</h2><p>المطعم بيتأكد من التحويل قبل بدء التحضير. هنحدّثك هنا أول ما يتأكد.</p></div></section>}
      {o.status === 'CREATED' && <section className="tracking-state-card"><div className="tracking-state-icon"><ShoppingBag size={23} /></div><div><h2>طلبك وصل للمطعم</h2><p>في انتظار قبول الطلب. الدفع كاش عند الاستلام.</p></div></section>}
      {o.status === 'ARRIVED_AT_GATE' && <section className="tracking-arrived"><MapPin size={30} /><h2>طلبك وصل {o.deliveryPointName}</h2><p>قول للدليفري رقم الطلب <b dir="ltr">#{o.orderNumber}</b>{o.paymentMethod === 'CASH' ? ` وادفع ${formatMoney(o.total)}` : ''}.</p></section>}
      {o.status === 'COMPLETED' && <section className="tracking-arrived"><UtensilsCrossed size={30} /><h2>تم التسليم. بالهنا والشفا!</h2><p>نتمنى تكون استمتعت بطلبك.</p><Link href={`/s/${view.restaurant.slug}`} className="btn btn-primary mt-5">اطلب مرة تانية</Link></section>}
      {o.status === 'CANCELLED' && <section className="tracking-state-card is-cancelled"><AlertCircle size={26} /><div><h2>تم إلغاء الطلب</h2>{o.cancelReason && <p>{o.cancelReason}</p>}<Link href={`/s/${view.restaurant.slug}`} className="btn btn-primary mt-4">العودة للمنيو</Link></div></section>}

      {!['CANCELLED', 'AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'CREATED'].includes(o.status) && <section className="tracking-steps"><h2>رحلة طلبك</h2><ol>
        {STEPS.map((step, i) => {
          const reached = step.reached(o.status), active = step.active(o.status), Icon = stepIcons[i];
          return <li key={step.label} className={`${reached ? 'is-reached' : ''} ${active ? 'is-active' : ''}`} aria-current={active ? 'step' : undefined}>
            <span className="tracking-step-icon">{reached && i < activeStep ? <Check size={19} /> : <Icon size={19} />}</span><div><strong>{step.label}</strong>{active && <p>{o.status === 'READY' ? 'جاهز وفي انتظار التوصيل' : 'المرحلة الحالية'}</p>}</div>
          </li>;
        })}
      </ol></section>}
      </div>

      <aside className="tracking-secondary">
      <section className="tracking-summary"><div className="tracking-summary-heading"><h2>تفاصيل طلبك</h2><ShoppingBag size={19} /></div>
        <div className="tracking-delivery"><MapPin size={19} /><div><span>نقطة الاستلام</span><strong>{o.deliveryPointName}</strong></div></div>
        <div className="tracking-items">{o.items.map((it) => <div className="tracking-item" key={it.id}><span className="tracking-item-qty">{it.quantity}</span><div><strong>{it.nameAr}</strong>{it.variantNameAr && <span>{it.variantNameAr}</span>}{it.addons.length > 0 && <span>{it.addons.map((a) => a.nameAr).join('، ')}</span>}{it.note && <span>ملاحظة: {it.note}</span>}</div><b>{formatMoney(it.lineTotal)}</b></div>)}</div>
        <div className="tracking-bill-row"><span>قيمة الأكل</span><span>{formatMoney(o.subtotal)}</span></div>
        {o.deliveryFee > 0 && <div className="tracking-bill-row"><span>التوصيل</span><span>{formatMoney(o.deliveryFee)}</span></div>}
        {o.discountTotal > 0 && <div className="tracking-bill-row is-discount"><span>الخصم</span><span>− {formatMoney(o.discountTotal)}</span></div>}
        <div className="tracking-total"><span>الإجمالي</span><strong>{formatMoney(o.total)}</strong></div>
        <div className="tracking-payment-method"><span>{o.paymentMethod === 'INSTAPAY' ? 'InstaPay' : 'كاش عند الاستلام'}</span>{o.paymentStatus === 'PAYMENT_VERIFIED' && <span><CheckCheck size={14} />تم تأكيد الدفع</span>}</div>
      </section>
      {view.restaurant.phone && <a href={`tel:${view.restaurant.phone}`} className="tracking-contact"><Phone size={19} /><span><strong>محتاج مساعدة في طلبك؟</strong><small>كلم المطعم مباشرة</small></span><ArrowRight size={17} /></a>}
      {(o.status === 'AWAITING_PAYMENT' || o.status === 'CREATED') && <CancelButton token={token} onDone={refresh} />}
      <p className="tracking-privacy">رابط المتابعة خاص بطلبك. شاركه مع شخص تثق به فقط.</p>
      </aside>
      </div>
    </main>
  );
}

function CopyRow({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <div className={compact ? "tracking-copy-compact" : "flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2"}>
      {!compact && <div className="min-w-0">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="truncate font-bold" dir="ltr">{value}</div>
      </div>}
      <button
        aria-label={`نسخ ${label}`}
        className="btn btn-secondary btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setCopyError(false);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopyError(true);
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}{!compact && (copied ? 'اتنسخ' : 'نسخ')}
      </button>
      {copyError && <span className="text-xs text-red-600" role="status">النسخ غير متاح. حدّد النص وانسخه.</span>}
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
  bitmap.close();
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
        signal: AbortSignal.timeout(10000),
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
    <section className="tracking-payment-card space-y-4">
      <h2 className="text-lg font-semibold">كمّل الدفع بـ InstaPay</h2><p className="text-xs leading-6 text-stone-500">حوّل المبلغ للحساب الموضّح، وبعدها اضغط «تم التحويل» عشان المطعم يراجعه.</p>
      {o.paymentStatus === 'PAYMENT_REJECTED' && (
        <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">المحل ملقاش التحويل: {o.paymentRejectedReason || 'راجع البيانات وحاول تاني'}</p>
      )}
      <div className="rounded-xl bg-stone-50 p-3 text-center">
        <div className="text-sm text-stone-500">المبلغ المطلوب</div>
        <div className="text-3xl font-semibold text-green-900">{formatMoney(o.total)}</div>
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
          <Paperclip size={16} /> {file ? file.name.slice(0, 28) : 'اختار صورة من الموبايل'}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {file && <button className="btn btn-ghost btn-sm" onClick={() => setFile(null)}><X size={14} />إزالة الصورة</button>}
      {error && <p className="text-sm font-semibold text-red-600" role="alert">{error}</p>}
      <button className="btn btn-success btn-lg w-full" disabled={busy || (deadlineLeft !== null && deadlineLeft <= 0)} onClick={submit}>{busy ? 'جاري الإرسال…' : 'تم التحويل ✓'}</button>
      {deadlineLeft !== null && deadlineLeft <= 0 && <p className="text-sm text-red-700" role="status">انتهت مهلة الدفع. بنحدّث حالة طلبك…</p>}
      {deadlineLeft !== null && deadlineLeft > 0 && (
        <p className="text-center text-xs text-gray-500">لو مفيش تحويل خلال <span dir="ltr" className="font-mono">{mmss(deadlineLeft)}</span> الطلب هيتلغي تلقائيًا</p>
      )}
    </section>
  );
}

function CancelButton({ token, onDone }: { token: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/public/orders/${token}/cancel`, { method: 'POST', signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message || 'تعذّر إلغاء الطلب. جرّب تاني.');
      } else setConfirming(false);
      onDone();
    } catch { setError('الرد موصلناش بسبب الاتصال. بنراجع حالة الطلب؛ ممكن الإلغاء يكون تم.'); onDone(); }
    finally { setBusy(false); }
  }
  if (!confirming) return <button className="btn btn-ghost w-full text-red-700" onClick={() => setConfirming(true)}>إلغاء الطلب</button>;
  return <div className="card space-y-3"><p className="text-sm font-semibold">متأكد إنك عايز تلغي الطلب؟</p><div className="flex gap-2"><button className="btn btn-secondary flex-1" disabled={busy} onClick={() => setConfirming(false)}>خلي الطلب</button><button className="btn btn-danger flex-1" disabled={busy} onClick={cancel}>{busy ? 'جاري الإلغاء…' : 'أيوه، إلغاء'}</button></div>{error && <p className="text-xs text-red-700" role="alert">{error}</p>}</div>;
}
