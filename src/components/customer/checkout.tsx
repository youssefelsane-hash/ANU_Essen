'use client';

import Link from 'next/link';
import { useLanguage } from '@/components/language-provider';
import { LanguageSwitcher } from '@/components/language-switcher';
import { localizedName } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Banknote, Check, Clock3, CreditCard, LoaderCircle, MapPin, Minus, Pencil, Plus, ShieldCheck, ShoppingBag, Store, Tag, Trash2, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { estimateLine, useCart } from '@/client/cart';
import { fingerprint, uuid } from '@/client/ids';
import { PROFILE_KEY, prefsKey, readJson, rememberOrder, writeJson, type CheckoutPrefs } from '@/client/storage';
import { formatMoney, normalizeEgyptianPhone } from '@/lib/domain/misc';
import { brandTextColor } from '@/lib/domain/restaurant-brand';
import type { PaymentMethod } from '@/lib/domain/order-machine';
import type { CustomerQuoteResponse, PublicMenu } from '@/lib/types';
import { customerMessage } from './messages';
import './customer.css';

interface ApiError { error?: { code: string; message: string }; }
interface QuoteState { key: string; data?: CustomerQuoteResponse; error?: string; }

export function Checkout({ menu: initialMenu }: { menu: PublicMenu }) {
  const { locale, t } = useLanguage();
  const [menu, setMenu] = useState(initialMenu);
  const router = useRouter();
  const slug = menu.restaurant.slug;
  const { lines, setQuantity, clear } = useCart(slug);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  /** Returning customer: name + phone come from this phone, shown as one compact line. */
  const [profileSaved, setProfileSaved] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
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
    const profileComplete = (profile.name ?? '').trim().length >= 2 &&
      (profile.phone ? !!normalizeEgyptianPhone(profile.phone) : !menu.restaurant.requirePhone);
    setProfileSaved(profileComplete);
    const prefs = readJson<CheckoutPrefs>(prefsKey(slug), {});
    if (prefs.paymentMethod && menu.paymentMethods.some((m) => m.method === prefs.paymentMethod)) setMethod(prefs.paymentMethod);
    if (prefs.deliveryPointId && menu.deliveryPoints.some((p) => p.id === prefs.deliveryPointId)) setPointId(prefs.deliveryPointId);
    setOnline(navigator.onLine);
    const ctrl = new AbortController();
    const refreshLive = async () => {
      if (document.hidden || !navigator.onLine || submissionLock.current) return;
      try {
        const response = await fetch('/api/public/stores/' + slug, { cache: 'no-store', signal: ctrl.signal });
        if (response.ok) {
          const latest = await response.json() as PublicMenu;
          setMenu(latest);
          setStoreStatus(latest.store.status);
          setMethod((current) => latest.paymentMethods.some((m) => m.method === current) ? current : latest.paymentMethods[0]?.method ?? null);
          setPointId((current) => latest.deliveryPoints.some((p) => p.id === current) ? current : (latest.deliveryPoints.find((p) => p.isDefault) ?? latest.deliveryPoints[0])?.id);
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
        const data = await res.json() as CustomerQuoteResponse & ApiError;
        if (disposed) return;
        setQuoteState(res.ok
          ? { key: requestKey, data }
          : { key: requestKey, error: data.error?.message ?? t("تعذر حساب الطلب. جرّب مرة تانية.", "We couldn't calculate your order. Please try again.") });
      } catch (err) {
        if (!disposed && (timedOut || (err as Error).name !== 'AbortError')) setQuoteState({ key: requestKey, error: t("الاتصال مش مستقر. جرّب تحديث حساب الطلب.", "The connection is unstable. Try refreshing your order total.") });
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
  const allAvailable = lines.every((line) => estimateLine(menu, line, locale).available);
  const canSubmit = accepting && online && !!quote && !quoteError && quote.minOrderShortfall === 0 && allAvailable &&
    name.trim().length >= 2 && phoneValid && !!method && !submitting && (menu.deliveryPoints.length === 0 || !!pointId);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const submitHint = !online ? t("اتصل بالإنترنت لتأكيد الطلب.", "Connect to the internet to confirm your order.") : !accepting ? t("المطعم مش بيستقبل طلبات حاليًا.", "The restaurant isn't taking orders right now.") :
    !allAvailable ? t("احذف الأصناف غير المتاحة عشان تكمل الطلب.", "Remove unavailable items to continue.") :
    quoteError ? t("حدّث حساب الطلب عشان تقدر تأكد.", "Refresh your order total to confirm.") :
    !quote ? t("بنراجع الأسعار ووقت الوصول…", "Checking prices and arrival time…") :
    quote.minOrderShortfall > 0 ? t("زوّد ", "Add ") + formatMoney(quote.minOrderShortfall, locale) + t(" للوصول للحد الأدنى.", " to reach the minimum order.") :
    name.trim().length < 2 ? t("اكتب اسمك عشان نعرف نناديك وقت الاستلام.", "Enter your name so we can find you at pickup.") :
    !phoneValid ? (phone ? t("راجع رقم الموبايل، لازم يكون رقم مصري صحيح.", "Please enter a valid Egyptian mobile number.") : t("اكتب رقم الموبايل عشان نقدر نوصلك.", "Enter your mobile number so we can reach you.")) :
    !method ? t("مفيش طريقة دفع متاحة حاليًا.", "No payment method is currently available.") :
    menu.deliveryPoints.length > 0 && !pointId ? t("اختار نقطة الاستلام.", "Choose a pickup point.") : '';

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
        setError(data.error?.message ?? t("تعذر تأكيد الطلب. حاول مرة تانية.", "We couldn't confirm your order. Please try again."));
        setRefreshVersion((version) => version + 1);
        submissionLock.current = false;
        setSubmitting(false);
        return;
      }
      rememberOrder({ token: data.trackingToken, orderNumber: data.orderNumber, slug, createdAt: Date.now(), lines: items, total: quote?.total });
      writeJson(prefsKey(slug), { paymentMethod: method, deliveryPointId: pointId } satisfies CheckoutPrefs);
      writeJson(attemptKey, null, 'session');
      clear();
      router.replace('/order/' + data.trackingToken);
    } catch {
      setError(t("الاتصال انقطع. اضغط تأكيد مرة تانية؛ المحاولة محفوظة ومش هيتكرر الطلب.", "The connection dropped. Confirm again; your attempt is saved and the order won't be duplicated."));
      submissionLock.current = false;
      setSubmitting(false);
    } finally {
      clearTimeout(timeout);
    }
  }

  const confirmButton = (extraClass = '') => (
    <button type="button" className={'customer-primary-button ' + extraClass} disabled={!canSubmit} onClick={submit}>
      {submitting ? <><LoaderCircle size={17} className="animate-spin" /><span>{t("بنأكد طلبك…", "Confirming your order…")}</span></> :
        <><span>{t("تأكيد الطلب", "Confirm order")}</span>{quote && <strong>{formatMoney(quote.total, locale)}</strong>}<ArrowLeft className="directional-arrow" size={17} /></>}
    </button>
  );

  if (!lines.length && submitting) return (
    <main className="customer-page checkout-empty-page" style={brandStyle}>
      <div className="customer-language-row"><LanguageSwitcher /></div>
      <div className="customer-empty" role="status"><LoaderCircle size={40} className="animate-spin" /><h1>{t("طلبك اتسجّل.", "Your order is saved.")}</h1><p>{t("بنفتح صفحة متابعة الطلب…", "Opening your order tracking…")}</p></div>
    </main>
  );

  if (!lines.length) return (
    <main className="customer-page checkout-empty-page" style={brandStyle}>
      <div className="customer-language-row"><LanguageSwitcher /></div>
      <div className="customer-empty"><ShoppingBag size={48} strokeWidth={1.2} /><span className="section-eyebrow">{localizedName(locale, menu.restaurant.nameAr, menu.restaurant.nameEn)}</span><h1>{t("وجبتك لسه بتستناك", "Your next meal is waiting")}</h1><p>{t("سلتك فاضية. اختار حاجة تحبها من المنيو وكمّل طلبك.", "Your basket is empty. Find something you love and continue your order.")}</p><Link href={'/s/' + slug} className="customer-primary-button">{t("اكتشف المنيو ", "Explore the menu ")}<ArrowLeft className="directional-arrow" size={17} /></Link></div>
    </main>
  );

  return (
    <main className="customer-page checkout-page" style={brandStyle}>
      <header className="checkout-topbar"><Link href={'/s/' + slug} className="checkout-back-link"><ArrowRight className="directional-arrow" size={17} />{t("كمّل اختيارك", "Back to menu")}</Link><span className="checkout-restaurant-name">{localizedName(locale, menu.restaurant.nameAr, menu.restaurant.nameEn)}</span><LanguageSwitcher /></header>
      <div className="checkout-page-heading"><span className="section-eyebrow">{t("خطوة أخيرة، وطلبك في الطريق", "One last step to your next meal")}</span><h1>{t("خلّص طلبك بسهولة.", "Finish your order.")}</h1><p>{t("راجع اختياراتك، حدّد الاستلام والدفع، وسيب الباقي علينا.", "Review your meal, choose pickup and payment, and we'll do the rest.")}</p><div className="checkout-steps" aria-label={t("خطوات إتمام الطلب", "Checkout steps")}><span><b>{t("١", "1")}</b>{t("مراجعة الطلب", "Review order")}</span><i /><span><b>{t("٢", "2")}</b>{t("بيانات الاستلام", "Pickup details")}</span><i /><span><b>{t("٣", "3")}</b>{t("التأكيد والدفع", "Confirm and pay")}</span></div></div>

      <div className="checkout-layout">
        <div className="checkout-fields">
          <section className="checkout-card">
            <div className="checkout-card-heading"><span className="checkout-section-number">01</span><div><h2>{t("اختياراتك", "Your choices")}</h2><p>{itemCount}{t(itemCount === 1 ? " صنف في طلبك" : " أصناف في طلبك", itemCount === 1 ? " item in your order" : " items in your order")}</p></div><Link className="checkout-edit-link" href={'/s/' + slug}>{t("ضيف حاجة كمان", "Add more")}</Link></div>
            {lines.map((line, index) => {
              const item = estimateLine(menu, line, locale);
              const product = menu.products.find((p) => p.id === line.productId);
              // The quote is the price authority. This matters for rare
              // piaster-rounding cases where independently rounded menu
              // components do not add up to the cart-rounded total.
              const quotedLine = quote?.lines[index];
              const quotedLineTotal = quotedLine && quotedLine.productId === line.productId && quotedLine.variantId === line.variantId && quotedLine.quantity === line.quantity
                ? quotedLine.lineTotal
                : null;
              return <div key={line.key} className="checkout-cart-line">
                <div className="checkout-line-title">{product?.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.imageUrl} alt="" className="checkout-line-image" width={52} height={56} />
                )}<div><h3>{item.name}</h3>{item.detail && <p>{item.detail}</p>}</div></div>
                <strong className="checkout-line-price">{quotedLineTotal === null ? '…' : formatMoney(quotedLineTotal, locale)}</strong>
                <div className="checkout-line-actions">
                  <div className="quantity-control"><button type="button" disabled={submitting} onClick={() => setQuantity(line.key, line.quantity - 1)} aria-label={t("تقليل كمية ", "Decrease quantity of ") + item.name}><Minus size={14} /></button><output aria-label={t("كمية ", "Quantity of ") + item.name}>{line.quantity}</output><button type="button" disabled={submitting || line.quantity >= 50} onClick={() => setQuantity(line.key, line.quantity + 1)} aria-label={t("زيادة كمية ", "Increase quantity of ") + item.name}><Plus size={14} /></button></div>
                  <button type="button" className="remove-line-button" disabled={submitting} onClick={() => setQuantity(line.key, 0)} aria-label={t("حذف ", "Remove ") + item.name}><Trash2 size={12} />{t("حذف", "Remove")}</button>
                </div>
                {!item.available && <p className="checkout-line-note">{t("الصنف مش متاح حاليًا. احذفه من السلة عشان تكمل.", "This item is unavailable. Remove it from your basket to continue.")}</p>}
              </div>;
            })}
          </section>

          <section className="checkout-card">
            <div className="checkout-card-heading"><span className="checkout-section-number">02</span><div><h2>{t("مين هيستلم الطلب؟", "Who is collecting?")}</h2><p>{t("بيانات بسيطة عشان طلبك يوصل بسهولة.", "A few details to make pickup easy.")}</p></div></div>
            {profileSaved && !editingProfile ? (
              <div className="saved-profile">
                <span className="saved-profile-icon"><UserRound size={20} /></span>
                <span><strong>{name}</strong>{phone && <span dir="ltr">{phone}</span>}<small>{t("بياناتك محفوظة على الموبايل ده", "Your details are saved on this device")}</small></span>
                <button type="button" disabled={submitting} onClick={() => setEditingProfile(true)}><Pencil size={13} />{t("تعديل", "Edit")}</button>
              </div>
            ) : (
            <div className="customer-form-grid">
                <div className="customer-form-field"><label htmlFor="customer-name">{t("اسمك", "Your name")}</label><input id="customer-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required disabled={submitting} minLength={2} maxLength={60} placeholder={t("الاسم اللي هنناديك بيه", "The name we'll call at pickup")} /></div>
                <div className="customer-form-field"><label htmlFor="customer-phone">{t("رقم الموبايل ", "Mobile number ")}{!menu.restaurant.requirePhone && <span>{t("(اختياري)", "(optional)")}</span>}</label><input id="customer-phone" type="tel" dir="ltr" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" maxLength={20} required={menu.restaurant.requirePhone} disabled={submitting} aria-invalid={!!phone && !phoneValid} aria-describedby="phone-help" /><small id="phone-help" className={phone && !phoneValid ? 'field-error' : ''}>{phone && !phoneValid ? t("راجع الرقم. محتاجين رقم موبايل مصري صحيح.", "Check your number. Please use a valid Egyptian mobile number.") : t("هنتصل بيك لو احتجنا مساعدة عند الاستلام.", "We'll call only if we need help finding you.")}</small></div>
              </div>
            )}
            <button type="button" className="customer-note-toggle" disabled={submitting} onClick={() => setShowNote(!showNote)} aria-expanded={showNote} aria-controls="customer-note-field"><Plus size={13} />{showNote ? t("إخفاء ملاحظة الطلب", "Hide order note") : t("عندك ملاحظة للمطبخ؟", "A note for the kitchen?")}</button>
            {showNote && <div className="customer-form-field customer-note-field" id="customer-note-field"><label htmlFor="customer-note">{t("ملاحظة الطلب ", "Order note ")}<span>{t("(اختياري)", "(optional)")}</span></label><textarea id="customer-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} disabled={submitting} placeholder={t("مثلاً: من غير بصل، أو ثومية على جنب", "For example: no onion, or garlic sauce on the side")} /><small>{note.length} / 300</small></div>}
          </section>

          <section className="checkout-card">
            <div className="checkout-card-heading"><span className="checkout-section-number">03</span><div><h2>{t("تستلم منين؟", "How would you like to get it?")}</h2><p>{t("نوصّلهولك لنقطة الاستلام، أو تستلمه بنفسك من المطعم.", "We bring it to a pickup point, or you collect it at the restaurant.")}</p></div></div>
            <div className="checkout-choice-list">
              {menu.deliveryPoints.length ? menu.deliveryPoints.map((point) => <label key={point.id} className={'customer-choice ' + (pointId === point.id ? 'is-selected' : '')}><input type="radio" name="delivery-point" checked={pointId === point.id} disabled={submitting} onChange={() => setPointId(point.id)} />{point.kind === 'PICKUP' ? <Store className="delivery-choice-icon" size={19} /> : <MapPin className="delivery-choice-icon" size={19} />}<span>{localizedName(locale, point.nameAr, point.nameEn)}{point.kind === 'PICKUP' ? <small className="pickup-hint">{t("بتستلمه بنفسك أول ما يجهز — من غير توصيل", "Collect it yourself as soon as it's ready")}</small> : point.isDefault && <small>{t("نقطة الاستلام الرئيسية", "Main pickup point")}</small>}</span><strong>{point.deliveryFee > 0 ? formatMoney(point.deliveryFee, locale) : t("بدون رسوم", "No fee")}</strong></label>) :
                <p className="checkout-line-note">{t("نقطة الاستلام بتتحدد مع المطعم.", "Arrange pickup with the restaurant.")}</p>}
            </div>
          </section>

          <section className="checkout-card">
            <div className="checkout-card-heading"><span className="checkout-section-number">04</span><div><h2>{t("تفضّل تدفع إزاي؟", "How would you like to pay?")}</h2><p>{t("اختار الطريقة الأنسب ليك.", "Choose the method that suits you.")}</p></div></div>
            <div className="checkout-choice-list">
              {menu.paymentMethods.length === 0 && <p className="checkout-line-note">{t("لا توجد طريقة دفع متاحة حاليًا.", "No payment method is currently available.")}</p>}
              {menu.paymentMethods.map(({ method: payment }) => <label key={payment} className={'customer-choice ' + (method === payment ? 'is-selected' : '')}><input type="radio" name="payment-method" checked={method === payment} disabled={submitting} onChange={() => setMethod(payment)} /><span className="checkout-payment-icon">{payment === 'INSTAPAY' ? <CreditCard size={18} /> : <Banknote size={18} />}</span><span>{payment === 'INSTAPAY' ? t('إنستاباي', 'InstaPay') : t("كاش عند الاستلام", "Cash on pickup")}<small>{payment === 'INSTAPAY' ? t("بيانات التحويل هتظهر بعد التأكيد. الدفع بيتراجع من المطعم.", "Transfer details appear after confirmation. The restaurant checks your payment.") : t("ادفع لما طلبك يوصل لنقطة الاستلام.", "Pay when your order reaches the pickup point.")}</small></span></label>)}
            </div>
          </section>
          {!accepting && <div className="customer-alert" role="status">{menu.store.reason === 'INACTIVE' ? t("الطلب أونلاين من المطعم ده متوقف مؤقتًا.", "Online ordering is temporarily unavailable.") : storeStatus === 'PAUSED' ? t("الطلبات متوقفة مؤقتًا بسبب ضغط المطبخ. سلتك محفوظة.", "Ordering is paused while the kitchen is busy. Your basket is saved.") : t("المطعم مغلق حاليًا. اختياراتك محفوظة في السلة.", "The restaurant is closed. Your basket is saved.")}</div>}
          {!online && <div className="customer-alert" role="status">{t("الاتصال بالإنترنت انقطع. سلتك محفوظة وهتقدر تكمل أول ما الاتصال يرجع.", "You're offline. Your basket is saved; continue when the connection returns.")}</div>}
          {error && <div className="customer-alert" role="alert">{customerMessage(error, locale)}</div>}
        </div>

        <aside className="checkout-summary" aria-label={t("ملخص السعر ووقت الوصول", "Price and arrival summary")}>
          <section className="checkout-card">
            <h2 className="checkout-summary-heading"><ShoppingBag size={20} />{t("ملخص طلبك", "Your order summary")}</h2>
            {quote ? <>
              <div className="checkout-eta"><Clock3 size={25} strokeWidth={1.5} /><div><span>{menu.deliveryPoints.find((p) => p.id === pointId)?.kind === 'PICKUP' ? t("جاهز للاستلام من المطعم خلال", "Ready to collect in") : t("وقت الوصول المتوقع", "Estimated arrival")}</span><strong>{t("حوالي ", "About ")}{quote.etaMinutes}{t(" دقيقة", " minutes")}</strong><small>{t("تقدير بيتحدث حسب ضغط المطبخ؛ التوقيت يتأكد بعد قبول الطلب.", "This estimate changes with kitchen demand. Timing is confirmed when your order is accepted.")}</small></div></div>
              <div className="checkout-money-rows"><MoneyRow label={t("قيمة الأصناف", "Items subtotal")} value={formatMoney(quote.subtotal, locale)} />{quote.discount > 0 && <MoneyRow label={t("خصم طلبك", "Your discount")} value={'− ' + formatMoney(quote.discount, locale)} discount />}<MoneyRow label={t("رسوم التوصيل", "Delivery fee")} value={quote.deliveryFee > 0 ? formatMoney(quote.deliveryFee, locale) : t("مجانًا", "Free")} />{(quote.serviceFee ?? 0) > 0 && <MoneyRow label={t("رسوم الخدمة", "Service fee")} value={formatMoney(quote.serviceFee ?? 0, locale)} />}</div>
              <div className="checkout-grand-total"><span>{t("الإجمالي", "Total")}</span><strong>{formatMoney(quote.total, locale)}</strong></div>
              {quote.minOrderShortfall > 0 && <p className="checkout-submit-hint">{t("الحد الأدنى ", "Minimum order ")}{formatMoney(quote.minOrderAmount, locale)}{t(". ضيف ", ". Add ")}{formatMoney(quote.minOrderShortfall, locale)}{t(" عشان تكمل.", " to continue.")}</p>}
            </> : quoteError ? <div className="quote-error" role="alert"><p>{customerMessage(quoteError, locale)}</p><button type="button" className="customer-secondary-button" disabled={submitting} onClick={() => setRefreshVersion((version) => version + 1)}>{t("تحديث حساب الطلب", "Refresh order total")}</button></div> :
              <div className="quote-loading" role="status" aria-live="polite"><p>{t("بنراجع السعر ووقت الوصول…", "Checking price and arrival time…")}</p><div /><div /><div /></div>}
            <div className="checkout-promo">
              <button type="button" className="checkout-promo-toggle" onClick={() => setShowPromo(!showPromo)} disabled={submitting} aria-expanded={showPromo} aria-controls="promo-controls"><Tag size={14} />{promoCode ? t("كود الخصم: ", "Promo code: ") + promoCode : t("عندك كود خصم؟", "Have a promo code?")}</button>
              {showPromo && <div className="checkout-promo-controls" id="promo-controls"><input aria-label={t("كود الخصم", "Promo code")} value={promoInput} onChange={(event) => setPromoInput(event.target.value.toUpperCase())} placeholder="WELCOME10" dir="ltr" maxLength={32} disabled={!!promoCode || submitting} />{promoCode ? <button type="button" disabled={submitting} onClick={() => { setPromoCode(null); setPromoInput(''); }}>{t("إزالة", "Remove")}</button> : <button type="button" disabled={!promoInput.trim() || submitting} onClick={() => setPromoCode(promoInput.trim())}>{t("تطبيق", "Apply")}</button>}</div>}
              {quote?.promoError && <p className="promo-message is-error" role="status">{customerMessage(quote.promoError.message, locale)}</p>}
              {quote?.promotion && <p className="promo-message is-success"><Check size={12} className="inline" /> {quote.promotion.code ?? t('خصم تلقائي', 'Automatic discount')}{t(" · الخصم اتضاف لطلبك.", " · Discount added to your order.")}</p>}
            </div>
            {submitHint && <p className="checkout-submit-hint desktop-confirm-button" aria-live="polite">{submitHint}</p>}
            {confirmButton('desktop-confirm-button')}
            <p className="checkout-safety-note"><ShieldCheck size={13} />{t("بعد تأكيد الطلب، إعادة المحاولة مش هتعمل طلب مكرر.", "Once confirmed, retrying won't duplicate your order.")}</p>
          </section>
          <div className="order-promise"><Clock3 size={20} /><h3>{t("من غير انتظار في الطابور.", "Skip the queue.")}</h3><p>{t("بعد التأكيد، هتفتح صفحة متابعة طلبك وتعرف كل تحديث أول بأول.", "After confirming, track your order and see every update as it happens.")}</p></div>
        </aside>
      </div>
      <div className="checkout-mobile-confirm">{submitHint && <p className="checkout-submit-hint" aria-live="polite">{submitHint}</p>}{confirmButton()}<small>{t("السعر النهائي ظاهر قبل التأكيد · تتابع طلبك بعدها مباشرة", "See the final total before confirming · Track your order straight away")}</small></div>
    </main>
  );
}

function MoneyRow({ label, value, discount = false }: { label: string; value: string; discount?: boolean }) {
  return <div className={'checkout-money-row ' + (discount ? 'is-discount' : '')}><span>{label}</span><strong>{value}</strong></div>;
}
