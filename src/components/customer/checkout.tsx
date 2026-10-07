'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Banknote, Check, Clock3, CreditCard, LoaderCircle, MapPin, Minus, Plus, ShieldCheck, ShoppingBag, Tag, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { estimateLine, useCart } from '@/client/cart';
import { fingerprint, uuid } from '@/client/ids';
import { PROFILE_KEY, readJson, rememberOrder, writeJson } from '@/client/storage';
import { formatMoney, normalizeEgyptianPhone } from '@/lib/domain/misc';
import { brandTextColor } from '@/lib/domain/restaurant-brand';
import type { PaymentMethod } from '@/lib/domain/order-machine';
import type { PublicMenu, QuoteResponse } from '@/lib/types';
import './customer.css';

interface ApiError { error?: { code: string; message: string }; }
interface QuoteState { key: string; data?: QuoteResponse; error?: string; }

export function Checkout({ menu }: { menu: PublicMenu }) {
  const router = useRouter();
  const slug = menu.restaurant.slug;
  const { lines, setQuantity, clear } = useCart(slug);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [showPromo, setShowPromo] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(menu.paymentMethods[0]?.method ?? null);
  const defaultPoint = menu.deliveryPoints.find((p) => p.isDefault) ?? menu.deliveryPoints[0];
  const [pointId, setPointId] = useState<string | undefined>(defaultPoint?.id);
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submissionLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [storeStatus, setStoreStatus] = useState(menu.store.status);
  const accepting = storeStatus === 'OPEN' || storeStatus === 'BUSY';
  const brandColor = menu.restaurant.brandColor || '#263c2c';
  const brandStyle = { '--customer-brand': brandColor, '--customer-brand-text': brandTextColor(brandColor) } as CSSProperties;

  useEffect(() => {
    const profile = readJson<{ name?: string; phone?: string }>(PROFILE_KEY, {});
    if (profile.name) setName(profile.name);
    if (profile.phone) setPhone(profile.phone);
    setOnline(navigator.onLine);
    const ctrl = new AbortController();
    const refreshLive = async () => {
      if (document.hidden || !navigator.onLine || submissionLock.current) return;
      try {
        const response = await fetch('/api/public/stores/' + slug, { cache: 'no-store', signal: ctrl.signal });
        if (response.ok) {
          const latest = await response.json() as PublicMenu;
          setStoreStatus(latest.store.status);
        }
      } catch { /* A price quote still checks availability when the menu refresh fails. */ }
      if (!ctrl.signal.aborted) setRefreshVersion((version) => version + 1);
    };
    const onOnline = () => { setOnline(true); void refreshLive(); };
    const onOffline = () => setOnline(false);
    const timer = setInterval(() => {
      void refreshLive();
    }, 30_000);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      clearInterval(timer);
      ctrl.abort();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [slug]);

  const items = useMemo(() => lines.map((line) => ({
    productId: line.productId, variantId: line.variantId, addonIds: line.addonIds, quantity: line.quantity,
  })), [lines]);
  // The displayed quote belongs to exactly this cart, point and discount. An old response cannot authorize a new cart.
  const requestKey = fingerprint(JSON.stringify({ items, promoCode, pointId, refreshVersion }));
  const quote = quoteState?.key === requestKey ? quoteState.data ?? null : null;
  const quoteError = quoteState?.key === requestKey ? quoteState.error ?? null : null;

  useEffect(() => {
    if (!items.length) return;
    const ctrl = new AbortController();
    let disposed = false;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; ctrl.abort(); }, 12_000);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/public/stores/' + slug + '/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items, promoCode, deliveryPointId: pointId }),
          signal: ctrl.signal,
        });
        const data = await res.json() as QuoteResponse & ApiError;
        if (disposed) return;
        setQuoteState(res.ok
          ? { key: requestKey, data }
          : { key: requestKey, error: data.error?.message ?? 'تعذر حساب الطلب. جرّب مرة تانية.' });
      } catch (err) {
        if (!disposed && (timedOut || (err as Error).name !== 'AbortError')) setQuoteState({ key: requestKey, error: 'الاتصال مش مستقر. جرّب تحديث حساب الطلب.' });
      } finally {
        clearTimeout(timeout);
      }
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(timeout);
      ctrl.abort();
    };
  }, [items, promoCode, pointId, slug, requestKey]);

  const phoneValid = !phone ? !menu.restaurant.requirePhone : !!normalizeEgyptianPhone(phone);
  const allAvailable = lines.every((line) => estimateLine(menu, line).available);
  const canSubmit = accepting && online && !!quote && !quoteError && quote.minOrderShortfall === 0 && allAvailable &&
    name.trim().length >= 2 && phoneValid && !!method && !submitting && (menu.deliveryPoints.length === 0 || !!pointId);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const submitHint = !online ? 'اتصل بالإنترنت لتأكيد الطلب.' : !accepting ? 'المطعم مش بيستقبل طلبات حاليًا.' :
    !allAvailable ? 'احذف الأصناف غير المتاحة عشان تكمل الطلب.' :
    quoteError ? 'حدّث حساب الطلب عشان تقدر تأكد.' :
    !quote ? 'بنراجع الأسعار ووقت الوصول…' :
    quote.minOrderShortfall > 0 ? 'زوّد ' + formatMoney(quote.minOrderShortfall) + ' للوصول للحد الأدنى.' :
    name.trim().length < 2 ? 'اكتب اسمك عشان نعرف نناديك وقت الاستلام.' :
    !phoneValid ? (phone ? 'راجع رقم الموبايل، لازم يكون رقم مصري صحيح.' : 'اكتب رقم الموبايل عشان نقدر نوصلك.') :
    !method ? 'مفيش طريقة دفع متاحة حاليًا.' :
    menu.deliveryPoints.length > 0 && !pointId ? 'اختار نقطة الاستلام.' : '';

  async function submit() {
    if (!canSubmit || !method || submissionLock.current) return;
    submissionLock.current = true;
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
      source: readJson<string | null>('utm:' + slug, null, 'session'),
    };
    // Preserve the key for this payload across retries, including an uncertain network response.
    const hash = fingerprint(JSON.stringify(payload));
    const attemptKey = 'checkout-attempt:' + slug;
    const previous = readJson<{ hash: string; key: string } | null>(attemptKey, null, 'session');
    const key = previous?.hash === hash ? previous.key : uuid();
    writeJson(attemptKey, { hash, key }, 'session');
    writeJson(PROFILE_KEY, { name: payload.customerName, phone: payload.customerPhone ?? '' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const res = await fetch('/api/public/stores/' + slug + '/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json() as { trackingToken: string; orderNumber: string } & ApiError;
      if (!res.ok) {
        setError(data.error?.message ?? 'تعذر تأكيد الطلب. حاول مرة تانية.');
        setRefreshVersion((version) => version + 1);
        submissionLock.current = false;
        setSubmitting(false);
        return;
      }
      rememberOrder({ token: data.trackingToken, orderNumber: data.orderNumber, slug, createdAt: Date.now() });
      writeJson(attemptKey, null, 'session');
      clear();
      router.replace('/order/' + data.trackingToken);
    } catch {
      setError('الاتصال انقطع. اضغط تأكيد مرة تانية؛ المحاولة محفوظة ومش هيتكرر الطلب.');
      submissionLock.current = false;
      setSubmitting(false);
    } finally {
      clearTimeout(timeout);
    }
  }

  const confirmButton = (extraClass = '') => (
    <button type="button" className={'customer-primary-button ' + extraClass} disabled={!canSubmit} onClick={submit}>
      {submitting ? <><LoaderCircle size={17} className="animate-spin" /><span>بنأكد طلبك…</span></> :
        <><span>تأكيد الطلب</span>{quote && <strong>{formatMoney(quote.total)}</strong>}<ArrowLeft size={17} /></>}
    </button>
  );

  if (!lines.length && submitting) return (
    <main className="customer-page checkout-empty-page" style={brandStyle}>
      <div className="customer-empty" role="status"><LoaderCircle size={40} className="animate-spin" /><h1>طلبك اتسجّل.</h1><p>بنفتح صفحة متابعة الطلب…</p></div>
    </main>
  );

  if (!lines.length) return (
    <main className="customer-page checkout-empty-page" style={brandStyle}>
      <div className="customer-empty"><ShoppingBag size={48} strokeWidth={1.2} /><span className="section-eyebrow">{menu.restaurant.nameAr}</span><h1>وجبتك لسه بتستناك</h1><p>سلتك فاضية. اختار حاجة تحبها من المنيو وكمّل طلبك.</p><Link href={'/s/' + slug} className="customer-primary-button">اكتشف المنيو <ArrowLeft size={17} /></Link></div>
    </main>
  );

  return (
    <main className="customer-page checkout-page" style={brandStyle}>
      <header className="checkout-topbar"><Link href={'/s/' + slug} className="checkout-back-link"><ArrowRight size={17} />كمّل اختيارك</Link><span className="checkout-restaurant-name">{menu.restaurant.nameAr}</span></header>
      <div className="checkout-page-heading"><span className="section-eyebrow">خطوة أخيرة، وطلبك في الطريق</span><h1>خلّص طلبك بسهولة.</h1><p>راجع اختياراتك، حدّد الاستلام والدفع، وسيب الباقي علينا.</p><div className="checkout-steps" aria-label="خطوات إتمام الطلب"><span><b>١</b>مراجعة الطلب</span><i /><span><b>٢</b>بيانات الاستلام</span><i /><span><b>٣</b>التأكيد والدفع</span></div></div>

      <div className="checkout-layout">
        <div className="checkout-fields">
          <section className="checkout-card">
            <div className="checkout-card-heading"><span className="checkout-section-number">01</span><div><h2>اختياراتك</h2><p>{itemCount} أصناف في طلبك</p></div><Link className="checkout-edit-link" href={'/s/' + slug}>ضيف حاجة كمان</Link></div>
            {lines.map((line) => {
              const item = estimateLine(menu, line);
              const product = menu.products.find((p) => p.id === line.productId);
              return <div key={line.key} className="checkout-cart-line">
                <div className="checkout-line-title">{product?.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.imageUrl} alt="" className="checkout-line-image" width={52} height={56} />
                )}<div><h3>{item.name}</h3>{item.detail && <p>{item.detail}</p>}</div></div>
                <strong className="checkout-line-price">{formatMoney(item.total)}</strong>
                <div className="checkout-line-actions">
                  <div className="quantity-control"><button type="button" disabled={submitting} onClick={() => setQuantity(line.key, line.quantity - 1)} aria-label={'تقليل كمية ' + item.name}><Minus size={14} /></button><output aria-label={'كمية ' + item.name}>{line.quantity}</output><button type="button" disabled={submitting || line.quantity >= 50} onClick={() => setQuantity(line.key, line.quantity + 1)} aria-label={'زيادة كمية ' + item.name}><Plus size={14} /></button></div>
                  <button type="button" className="remove-line-button" disabled={submitting} onClick={() => setQuantity(line.key, 0)} aria-label={'حذف ' + item.name}><Trash2 size={12} />حذف</button>
                </div>
                {!item.available && <p className="checkout-line-note">الصنف مش متاح حاليًا. احذفه من السلة عشان تكمل.</p>}
              </div>;
            })}
          </section>

          <section className="checkout-card">
            <div className="checkout-card-heading"><span className="checkout-section-number">02</span><div><h2>مين هيستلم الطلب؟</h2><p>بيانات بسيطة عشان طلبك يوصل بسهولة.</p></div></div>
            <div className="customer-form-grid">
              <div className="customer-form-field"><label htmlFor="customer-name">اسمك</label><input id="customer-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required disabled={submitting} minLength={2} maxLength={60} placeholder="الاسم اللي هنناديك بيه" /></div>
              <div className="customer-form-field"><label htmlFor="customer-phone">رقم الموبايل {!menu.restaurant.requirePhone && <span>(اختياري)</span>}</label><input id="customer-phone" type="tel" dir="ltr" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" maxLength={20} required={menu.restaurant.requirePhone} disabled={submitting} aria-invalid={!!phone && !phoneValid} aria-describedby="phone-help" /><small id="phone-help" className={phone && !phoneValid ? 'field-error' : ''}>{phone && !phoneValid ? 'راجع الرقم. محتاجين رقم موبايل مصري صحيح.' : 'هنتصل بيك لو احتجنا مساعدة عند الاستلام.'}</small></div>
            </div>
            <button type="button" className="customer-note-toggle" disabled={submitting} onClick={() => setShowNote(!showNote)} aria-expanded={showNote} aria-controls="customer-note-field"><Plus size={13} />{showNote ? 'إخفاء ملاحظة الطلب' : 'عندك ملاحظة للمطبخ؟'}</button>
            {showNote && <div className="customer-form-field customer-note-field" id="customer-note-field"><label htmlFor="customer-note">ملاحظة الطلب <span>(اختياري)</span></label><textarea id="customer-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} disabled={submitting} placeholder="مثلاً: من غير بصل، أو ثومية على جنب" /><small>{note.length} / 300</small></div>}
          </section>

          <section className="checkout-card">
            <div className="checkout-card-heading"><span className="checkout-section-number">03</span><div><h2>هنقابلك فين؟</h2><p>اختار نقطة الاستلام المناسبة ليك.</p></div></div>
            <div className="checkout-choice-list">
              {menu.deliveryPoints.length ? menu.deliveryPoints.map((point) => <label key={point.id} className={'customer-choice ' + (pointId === point.id ? 'is-selected' : '')}><input type="radio" name="delivery-point" checked={pointId === point.id} disabled={submitting} onChange={() => setPointId(point.id)} /><MapPin className="delivery-choice-icon" size={19} /><span>{point.nameAr}{point.isDefault && <small>نقطة الاستلام الرئيسية</small>}</span><strong>{point.deliveryFee > 0 ? formatMoney(point.deliveryFee) : 'بدون رسوم'}</strong></label>) :
                <p className="checkout-line-note">نقطة الاستلام بتتحدد مع المطعم.</p>}
            </div>
          </section>

          <section className="checkout-card">
            <div className="checkout-card-heading"><span className="checkout-section-number">04</span><div><h2>تفضّل تدفع إزاي؟</h2><p>اختار الطريقة الأنسب ليك.</p></div></div>
            <div className="checkout-choice-list">
              {menu.paymentMethods.length === 0 && <p className="checkout-line-note">لا توجد طريقة دفع متاحة حاليًا.</p>}
              {menu.paymentMethods.map(({ method: payment }) => <label key={payment} className={'customer-choice ' + (method === payment ? 'is-selected' : '')}><input type="radio" name="payment-method" checked={method === payment} disabled={submitting} onChange={() => setMethod(payment)} /><span className="checkout-payment-icon">{payment === 'INSTAPAY' ? <CreditCard size={18} /> : <Banknote size={18} />}</span><span>{payment === 'INSTAPAY' ? 'InstaPay' : 'كاش عند الاستلام'}<small>{payment === 'INSTAPAY' ? 'بيانات التحويل هتظهر بعد التأكيد. الدفع بيتراجع من المطعم.' : 'ادفع لما طلبك يوصل لنقطة الاستلام.'}</small></span></label>)}
            </div>
          </section>
          {!accepting && <div className="customer-alert" role="status">{storeStatus === 'PAUSED' ? 'الطلبات متوقفة مؤقتًا بسبب ضغط المطبخ. سلتك محفوظة.' : 'المطعم مغلق حاليًا. اختياراتك محفوظة في السلة.'}</div>}
          {!online && <div className="customer-alert" role="status">الاتصال بالإنترنت انقطع. سلتك محفوظة وهتقدر تكمل أول ما الاتصال يرجع.</div>}
          {error && <div className="customer-alert" role="alert">{error}</div>}
        </div>

        <aside className="checkout-summary" aria-label="ملخص السعر ووقت الوصول">
          <section className="checkout-card">
            <h2 className="checkout-summary-heading"><ShoppingBag size={20} />ملخص طلبك</h2>
            {quote ? <>
              <div className="checkout-eta"><Clock3 size={25} strokeWidth={1.5} /><div><span>وقت الوصول المتوقع</span><strong>حوالي {quote.etaMinutes} دقيقة</strong><small>تقدير بيتحدث حسب ضغط المطبخ؛ التوقيت يتأكد بعد قبول الطلب.</small></div></div>
              <div className="checkout-money-rows"><MoneyRow label="قيمة الأصناف" value={formatMoney(quote.subtotal)} />{quote.discount > 0 && <MoneyRow label="خصم طلبك" value={'− ' + formatMoney(quote.discount)} discount />}<MoneyRow label="رسوم التوصيل" value={quote.deliveryFee > 0 ? formatMoney(quote.deliveryFee) : 'مجانًا'} /></div>
              <div className="checkout-grand-total"><span>الإجمالي</span><strong>{formatMoney(quote.total)}</strong></div>
              {quote.minOrderShortfall > 0 && <p className="checkout-submit-hint">الحد الأدنى {formatMoney(quote.minOrderAmount)}. ضيف {formatMoney(quote.minOrderShortfall)} عشان تكمل.</p>}
            </> : quoteError ? <div className="quote-error" role="alert"><p>{quoteError}</p><button type="button" className="customer-secondary-button" disabled={submitting} onClick={() => setRefreshVersion((version) => version + 1)}>تحديث حساب الطلب</button></div> :
              <div className="quote-loading" role="status" aria-live="polite"><p>بنراجع السعر ووقت الوصول…</p><div /><div /><div /></div>}
            <div className="checkout-promo">
              <button type="button" className="checkout-promo-toggle" onClick={() => setShowPromo(!showPromo)} disabled={submitting} aria-expanded={showPromo} aria-controls="promo-controls"><Tag size={14} />{promoCode ? 'كود الخصم: ' + promoCode : 'عندك كود خصم؟'}</button>
              {showPromo && <div className="checkout-promo-controls" id="promo-controls"><input aria-label="كود الخصم" value={promoInput} onChange={(event) => setPromoInput(event.target.value.toUpperCase())} placeholder="WELCOME10" dir="ltr" maxLength={32} disabled={!!promoCode || submitting} />{promoCode ? <button type="button" disabled={submitting} onClick={() => { setPromoCode(null); setPromoInput(''); }}>إزالة</button> : <button type="button" disabled={!promoInput.trim() || submitting} onClick={() => setPromoCode(promoInput.trim())}>تطبيق</button>}</div>}
              {quote?.promoError && <p className="promo-message is-error" role="status">{quote.promoError.message}</p>}
              {quote?.promotion && <p className="promo-message is-success"><Check size={12} className="inline" /> {quote.promotion.code ?? quote.promotion.name} · الخصم اتضاف لطلبك.</p>}
            </div>
            {submitHint && <p className="checkout-submit-hint desktop-confirm-button" aria-live="polite">{submitHint}</p>}
            {confirmButton('desktop-confirm-button')}
            <p className="checkout-safety-note"><ShieldCheck size={13} />طلبك محفوظ والمحاولة مش بتتكرر.</p>
          </section>
          <div className="order-promise"><Clock3 size={20} /><h3>من غير انتظار في الطابور.</h3><p>بعد التأكيد، هتفتح صفحة متابعة طلبك وتعرف كل تحديث أول بأول.</p></div>
        </aside>
      </div>
      <div className="checkout-mobile-confirm">{submitHint && <p className="checkout-submit-hint" aria-live="polite">{submitHint}</p>}{confirmButton()}<small>السعر النهائي ظاهر قبل التأكيد · تتابع طلبك بعدها مباشرة</small></div>
    </main>
  );
}

function MoneyRow({ label, value, discount = false }: { label: string; value: string; discount?: boolean }) {
  return <div className={'checkout-money-row ' + (discount ? 'is-discount' : '')}><span>{label}</span><strong>{value}</strong></div>;
}
