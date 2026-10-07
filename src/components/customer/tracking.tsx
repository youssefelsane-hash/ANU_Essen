'use client';

import Link from 'next/link';
import { useLanguage } from '@/components/language-provider';
import { LanguageSwitcher } from '@/components/language-switcher';
import { localizedName } from '@/lib/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock3, Check, ChefHat, Bike, MapPin, ShoppingBag, Copy, CheckCheck, RefreshCw, Phone, UtensilsCrossed, AlertCircle, X, Paperclip } from 'lucide-react';
import { customerMessage } from './messages';
import './tracking.css';
import { formatMoney, formatTime } from '@/lib/domain/misc';
import { isTerminal, type OrderStatus } from '@/lib/domain/order-machine';
import type { TrackingView } from '@/lib/types';

function stepsFor(t: (ar: string, en: string) => string): { label: string; reached: (s: OrderStatus) => boolean; active: (s: OrderStatus) => boolean }[] { return [
  { label: t("الطلب اتأكد", "Order confirmed"), reached: (s) => ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'CONFIRMED' },
  { label: t("جاري التحضير", "Preparing your meal"), reached: (s) => ['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'PREPARING' || s === 'READY' },
  { label: t("خرج للتوصيل", "Out for delivery"), reached: (s) => ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'OUT_FOR_DELIVERY' },
  { label: t("وصل لنقطة الاستلام", "At the pickup point"), reached: (s) => ['ARRIVED_AT_GATE', 'COMPLETED'].includes(s), active: (s) => s === 'ARRIVED_AT_GATE' },
]; }

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
  const { locale, t } = useLanguage();
  const [view, setView] = useState(initial);
  const [offset, setOffset] = useState(() => initial.serverTime - Date.now());
  const [stale, setStale] = useState(false);
  const now = useNow(offset, initial.serverTime);
  const o = view.order;
  const steps = stepsFor(t);
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
  const activeStep = o.status === 'COMPLETED' ? 4 : Math.max(0, steps.findIndex((step) => step.active(o.status)));
  const stateLabel = o.status === 'CREATED' ? t("في انتظار تأكيد المطعم", "Waiting for the restaurant") : o.status === 'PAYMENT_REVIEW' ? t("بنراجع التحويل", "Checking your transfer") : o.status === 'AWAITING_PAYMENT' ? t("في انتظار الدفع", "Waiting for payment") : o.status === 'CONFIRMED' ? t("المطعم أكد طلبك", "Your order is confirmed") : o.status === 'PREPARING' ? t("أكلك بيتحضّر", "Your meal is being prepared") : o.status === 'READY' ? t("طلبك جاهز للتوصيل", "Ready for delivery") : o.status === 'OUT_FOR_DELIVERY' ? t("طلبك في الطريق", "Your order is on its way") : o.status === 'ARRIVED_AT_GATE' ? t("طلبك وصل", "Your order has arrived") : o.status === 'COMPLETED' ? t("بالهنا والشفا", "Enjoy your meal") : t("الطلب اتلغى", "Order cancelled");

  return (
    <main className="tracking-page">
      <header className="tracking-header">
        <Link href={`/s/${view.restaurant.slug}`}><ArrowRight className="directional-arrow" size={18} /> {localizedName(locale, view.restaurant.nameAr, view.restaurant.nameEn)}</Link>
        <div className="tracking-header-actions"><LanguageSwitcher /><span><span className={`tracking-dot ${stale ? 'is-stale' : ''}`} />{stale ? t("الاتصال ضعيف", "Connection unstable") : done ? t("اكتمل التحديث", "Updates complete") : t("متابعة مباشرة", "Live tracking")}</span></div>
      </header>
      {stale && <div className="tracking-warning" role="status"><AlertCircle size={17} /><span>{t("بنعرض آخر تحديث وصلنا. الوقت والحالة ممكن يتغيروا عند رجوع الاتصال.", "Showing the last update. Timing and status may change when the connection returns.")}</span><button onClick={refresh} aria-label={t("تحديث الطلب", "Refresh order")}><RefreshCw size={17} /></button></div>}
      <div className="tracking-layout">
      <div className="tracking-primary">
      <section className="tracking-order-head">
        <span className="tracking-eyebrow">{t("طلبك في أيدينا", "Your order is in good hands")}</span>
        <h1>{stateLabel}</h1>
        <div className="tracking-number"><span>{t("رقم طلبك", "Your order number")}</span><strong dir="ltr">#{o.orderNumber}</strong><CopyRow label={t("رقم الطلب", "Order number")} value={o.orderNumber} compact /></div>
        <p>{t("احتفظ بالرقم لاستلام طلبك بسهولة.", "Keep this number handy for pickup.")}</p>
      </section>

      {(inQueue || (provisional && o.estimatedArrivalAt)) && <section className={`tracking-eta ${provisional ? 'is-provisional' : ''}`}>
        <div className="tracking-eta-label"><Clock3 size={18} />{provisional ? t("الوقت المتوقع بعد التأكيد", "Estimated time after confirmation") : o.status === 'OUT_FOR_DELIVERY' ? t("متوقع يوصل خلال", "Expected to arrive in") : t("متوقع تستلم خلال", "Expected pickup in")}</div>
        {provisional ? <><strong className="tracking-eta-provisional">{t("حوالي ", "About ")}{Math.max(1, Math.ceil(((o.estimatedArrivalAt ?? now) - o.createdAt) / 60000))}{t(" دقيقة", " minutes")}</strong><p>{t("بيبدأ التحضير بعد ", "Preparation starts after ")}{o.paymentMethod === 'INSTAPAY' ? t("تأكيد التحويل", "payment is verified") : t("قبول المطعم للطلب", "the restaurant accepts your order")}{t("، والوقت بيتحدّث حسب ضغط المطبخ.", ", and timing changes with kitchen demand.")}</p></> : remaining !== null && remaining > 0 ? <>
          <div className="tracking-countdown" dir="ltr" aria-label={t("الوقت المتبقي تقريبًا", "Approximate time remaining")}>{mmss(remaining)}</div>
          <p>{t("وقت الاستلام المتوقع ", "Expected pickup time ")}<strong>{formatTime(o.estimatedArrivalAt!, view.restaurant.timezone, locale)}</strong></p>
        </> : <><strong className="tracking-eta-provisional">{t("بننتظر تحديث المطعم", "Waiting for a restaurant update")}</strong><p>{t("الطلب اتأخر عن الوقت المتوقع. هنحدّث الحالة أول ما المطعم يحدّثها.", "Your order is taking longer than estimated. We'll show the restaurant's next update here.")}</p></>}
        {!provisional && <div className="tracking-eta-foot">{t("الوقت تقديري وبيتحدّث مع حالة طلبك", "Timing is estimated and changes with your order status")}</div>}
      </section>}

      {o.status === 'AWAITING_PAYMENT' && view.instapay && <PaymentCard view={view} token={token} now={now} onSubmitted={refresh} />}
      {o.status === 'PAYMENT_REVIEW' && <section className="tracking-state-card"><div className="tracking-state-icon"><Clock3 size={23} /></div><div><h2>{t("التحويل تحت المراجعة", "Your transfer is being checked")}</h2><p>{t("المطعم بيتأكد من التحويل قبل بدء التحضير. هنحدّثك هنا أول ما يتأكد.", "The restaurant checks your transfer before preparing your order. We'll update this page when it's verified.")}</p></div></section>}
      {o.status === 'CREATED' && <section className="tracking-state-card"><div className="tracking-state-icon"><ShoppingBag size={23} /></div><div><h2>{t("طلبك وصل للمطعم", "The restaurant received your order")}</h2><p>{t("في انتظار قبول الطلب. الدفع كاش عند الاستلام.", "Waiting for the restaurant to accept. Pay cash at pickup.")}</p></div></section>}
      {o.status === 'ARRIVED_AT_GATE' && <section className="tracking-arrived"><MapPin size={30} /><h2>{t("طلبك وصل ", "Your order has arrived at ")}{localizedName(locale, o.deliveryPointName, o.deliveryPointNameEn)}</h2><p>{t("قول للدليفري رقم الطلب ", "Tell the courier your order number ")}<b dir="ltr">#{o.orderNumber}</b>{o.paymentMethod === 'CASH' ? t(' وادفع ', ' and pay ') + formatMoney(o.total, locale) : ''}.</p></section>}
      {o.status === 'COMPLETED' && <section className="tracking-arrived"><UtensilsCrossed size={30} /><h2>{t("تم التسليم. بالهنا والشفا!", "Delivered. Enjoy your meal!")}</h2><p>{t("نتمنى تكون استمتعت بطلبك.", "We hope you enjoyed your order.")}</p><Link href={`/s/${view.restaurant.slug}?reorder=${encodeURIComponent(token)}`} className="btn btn-primary mt-5">{t("اطلب نفس الطلب تاني", "Order the same meal again")}</Link></section>}
      {o.status === 'CANCELLED' && <section className="tracking-state-card is-cancelled"><AlertCircle size={26} /><div><h2>{t("تم إلغاء الطلب", "Order cancelled")}</h2>{o.cancelReason && <p>{customerMessage(o.cancelReason, locale)}</p>}<Link href={`/s/${view.restaurant.slug}?reorder=${encodeURIComponent(token)}`} className="btn btn-primary mt-4">{t("اطلب نفس الطلب من جديد", "Try this order again")}</Link></div></section>}

      {!['CANCELLED', 'AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'CREATED'].includes(o.status) && <section className="tracking-steps"><h2>{t("رحلة طلبك", "Your order's journey")}</h2><ol>
        {steps.map((step, i) => {
          const reached = step.reached(o.status), active = step.active(o.status), Icon = stepIcons[i];
          return <li key={step.label} className={`${reached ? 'is-reached' : ''} ${active ? 'is-active' : ''}`} aria-current={active ? 'step' : undefined}>
            <span className="tracking-step-icon">{reached && i < activeStep ? <Check size={19} /> : <Icon size={19} />}</span><div><strong>{step.label}</strong>{active && <p>{o.status === 'READY' ? t("جاهز وفي انتظار التوصيل", "Ready and waiting for delivery") : t("المرحلة الحالية", "Current stage")}</p>}</div>
          </li>;
        })}
      </ol></section>}
      </div>

      <aside className="tracking-secondary">
      <section className="tracking-summary"><div className="tracking-summary-heading"><h2>{t("تفاصيل طلبك", "Your order details")}</h2><ShoppingBag size={19} /></div>
        <div className="tracking-delivery"><MapPin size={19} /><div><span>{t("نقطة الاستلام", "Pickup point")}</span><strong>{localizedName(locale, o.deliveryPointName, o.deliveryPointNameEn)}</strong></div></div>
        <div className="tracking-items">{o.items.map((it) => <div className="tracking-item" key={it.id}><span className="tracking-item-qty">{it.quantity}</span><div><strong>{localizedName(locale, it.nameAr, it.nameEn)}</strong>{localizedName(locale, it.variantNameAr, it.variantNameEn) && <span>{localizedName(locale, it.variantNameAr, it.variantNameEn)}</span>}{it.addons.length > 0 && <span>{it.addons.map((a) => localizedName(locale, a.nameAr, a.nameEn)).join(t("، ", ", "))}</span>}{it.note && <span>{t("ملاحظة: ", "Note: ")}{it.note}</span>}</div><b>{formatMoney(it.lineTotal, locale)}</b></div>)}</div>
        <div className="tracking-bill-row"><span>{t("قيمة الأكل", "Items subtotal")}</span><span>{formatMoney(o.subtotal, locale)}</span></div>
        {o.deliveryFee > 0 && <div className="tracking-bill-row"><span>{t("التوصيل", "Delivery")}</span><span>{formatMoney(o.deliveryFee, locale)}</span></div>}
        {o.discountTotal > 0 && <div className="tracking-bill-row is-discount"><span>{t("الخصم", "Discount")}</span><span>− {formatMoney(o.discountTotal, locale)}</span></div>}
        <div className="tracking-total"><span>{t("الإجمالي", "Total")}</span><strong>{formatMoney(o.total, locale)}</strong></div>
        <div className="tracking-payment-method"><span>{o.paymentMethod === 'INSTAPAY' ? t('إنستاباي', 'InstaPay') : t("كاش عند الاستلام", "Cash on pickup")}</span>{o.paymentStatus === 'PAYMENT_VERIFIED' && <span><CheckCheck size={14} />{t("تم تأكيد الدفع", "Payment verified")}</span>}</div>
      </section>
      {view.restaurant.phone && <a href={`tel:${view.restaurant.phone}`} className="tracking-contact"><Phone size={19} /><span><strong>{t("محتاج مساعدة في طلبك؟", "Need help with your order?")}</strong><small>{t("كلم المطعم مباشرة", "Call the restaurant directly")}</small></span><ArrowRight className="directional-arrow" size={17} /></a>}
      {(o.status === 'AWAITING_PAYMENT' || o.status === 'CREATED') && <CancelButton token={token} onDone={refresh} />}
      <p className="tracking-privacy">{t("رابط المتابعة خاص بطلبك. شاركه مع شخص تثق به فقط.", "This tracking link is private. Share it only with someone you trust.")}</p>
      </aside>
      </div>
    </main>
  );
}

function CopyRow({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  const { locale, t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <div className={compact ? "tracking-copy-compact" : "flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2"}>
      {!compact && <div className="min-w-0">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="truncate font-bold" dir="ltr">{value}</div>
      </div>}
      <button
        aria-label={t('نسخ ', 'Copy ') + label}
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
        {copied ? <Check size={14} /> : <Copy size={14} />}{!compact && (copied ? t("اتنسخ", "Copied") : t("نسخ", "Copy"))}
      </button>
      {copyError && <span className="text-xs text-red-600" role="status">{t("النسخ غير متاح. حدّد النص وانسخه.", "Copy is unavailable. Select and copy the text manually.")}</span>}
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
  const { locale, t } = useLanguage();
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
        setError(t("مش قادرين نقرأ الصورة — تقدر تكمّل من غيرها", "We couldn't read the image. You can continue without it."));
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
        if (data.error?.code !== 'INVALID_TRANSITION') setError(data.error?.message ?? t("حصلت مشكلة، حاول تاني", "Something went wrong. Please try again."));
      }
      onSubmitted();
    } catch {
      setError(t("النت ضعيف — حاول تاني", "The connection is unstable. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tracking-payment-card space-y-4">
      <h2 className="text-lg font-semibold">{t("كمّل الدفع بإنستاباي", "Complete payment with InstaPay")}</h2><p className="text-xs leading-6 text-stone-500">{t("حوّل المبلغ للحساب الموضّح، وبعدها اضغط «تم التحويل» عشان المطعم يراجعه.", "Transfer the total to the account below, then tap “I've transferred” for the restaurant to check it.")}</p>
      {o.paymentStatus === 'PAYMENT_REJECTED' && (
        <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{t("المحل ملقاش التحويل: ", "The restaurant couldn't find your transfer: ")}{o.paymentRejectedReason || t("راجع البيانات وحاول تاني", "Check the details and try again")}</p>
      )}
      <div className="rounded-xl bg-stone-50 p-3 text-center">
        <div className="text-sm text-stone-500">{t("المبلغ المطلوب", "Amount to transfer")}</div>
        <div className="text-3xl font-semibold text-green-900">{formatMoney(o.total, locale)}</div>
      </div>
      {ip.address && <CopyRow label={t("عنوان إنستاباي", "InstaPay address")} value={ip.address} />}
      {ip.phone && <CopyRow label={t("أو رقم الموبايل", "Or mobile number")} value={ip.phone} />}
      <CopyRow label={t("اكتب في ملاحظة التحويل", "Use this transfer note")} value={t('طلب #', 'Order #') + o.orderNumber} />
      {ip.accountName && <p className="text-xs text-gray-500">{t("اسم الحساب: ", "Account name: ")}<b dir="ltr">{ip.accountName}</b></p>}
      {(ip.instructions || ip.instructionsEn) && <p className="text-xs text-gray-600">{localizedName(locale, ip.instructions, ip.instructionsEn)}</p>}
      {ip.link && (
        <a href={ip.link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full">{t("افتح إنستاباي", "Open InstaPay")}</a>
      )}
      <div>
        <label className="label" htmlFor="ref">{t("رقم العملية (اختياري)", "Transaction reference (optional)")}</label>
        <input id="ref" className="input" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={64} />
      </div>
      <div>
        <span className="label">{t("صورة التحويل (اختياري)", "Transfer screenshot (optional)")}</span>
        <label className="btn btn-secondary w-full cursor-pointer">
          <Paperclip size={16} /> {file ? file.name.slice(0, 28) : t("اختار صورة من الموبايل", "Choose an image")}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {file && <button className="btn btn-ghost btn-sm" onClick={() => setFile(null)}><X size={14} />{t("إزالة الصورة", "Remove image")}</button>}
      {error && <p className="text-sm font-semibold text-red-600" role="alert">{customerMessage(error, locale)}</p>}
      <button className="btn btn-success btn-lg w-full" disabled={busy || (deadlineLeft !== null && deadlineLeft <= 0)} onClick={submit}>{busy ? t("جاري الإرسال…", "Sending…") : t("تم التحويل ✓", "I've transferred ✓")}</button>
      {deadlineLeft !== null && deadlineLeft <= 0 && <p className="text-sm text-red-700" role="status">{t("انتهت مهلة الدفع. بنحدّث حالة طلبك…", "The payment window has ended. Updating your order…")}</p>}
      {deadlineLeft !== null && deadlineLeft > 0 && (
        <p className="text-center text-xs text-gray-500">{t("لو مفيش تحويل خلال ", "If payment isn't sent within ")}<span dir="ltr" className="font-mono">{mmss(deadlineLeft)}</span>{t(" الطلب هيتلغي تلقائيًا", " the order will be cancelled automatically")}</p>
      )}
    </section>
  );
}

function CancelButton({ token, onDone }: { token: string; onDone: () => void }) {
  const { locale, t } = useLanguage();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/public/orders/${token}/cancel`, { method: 'POST', signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message || t("تعذّر إلغاء الطلب. جرّب تاني.", "We couldn't cancel the order. Please try again."));
      } else setConfirming(false);
      onDone();
    } catch { setError(t("الرد موصلناش بسبب الاتصال. بنراجع حالة الطلب؛ ممكن الإلغاء يكون تم.", "The connection dropped before a reply. Checking your order; it may already be cancelled.")); onDone(); }
    finally { setBusy(false); }
  }
  if (!confirming) return <button className="btn btn-ghost w-full text-red-700" onClick={() => setConfirming(true)}>{t("إلغاء الطلب", "Cancel order")}</button>;
  return <div className="card space-y-3"><p className="text-sm font-semibold">{t("متأكد إنك عايز تلغي الطلب؟", "Cancel this order?")}</p><div className="flex gap-2"><button className="btn btn-secondary flex-1" disabled={busy} onClick={() => setConfirming(false)}>{t("خلي الطلب", "Keep order")}</button><button className="btn btn-danger flex-1" disabled={busy} onClick={cancel}>{busy ? t("جاري الإلغاء…", "Cancelling…") : t("أيوه، إلغاء", "Yes, cancel")}</button></div>{error && <p className="text-xs text-red-700" role="alert">{customerMessage(error, locale)}</p>}</div>;
}
