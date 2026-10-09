'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bike, MapPin, Maximize2, Minimize2, Moon, Phone, RefreshCw, Settings2, Sun, Volume2, VolumeX, Wallet } from 'lucide-react';
import { courierOrders, DeliveryBoardEngine, type CourierBoardState, type CourierOrder, type CourierStore } from '@/client/merchant/delivery-board';
import { useLanguage } from '@/components/language-provider';
import { formatMoney } from '@/lib/domain/misc';
import { localizedName, localizeMessage } from '@/lib/i18n';
import { primaryActionFor, type OrderAction } from '@/lib/domain/order-machine';
import { useScreenAwake } from './use-screen-awake';
import { useOrderSound } from './use-order-sound';
import './shared-delivery-board.css';

interface CashReport {
  viewerUserId: string;
  serverTime: number; restaurantId: string; nameAr: string; nameEn: string; dayStart: string; dayEnd: string;
  cashCollected: number; cashOutstanding: number; ordersCompleted: number; cashPending: number; handedIn: number;
  cashRefunds: number; merchantShare: number; platformShare: number;
}
interface CashResult { report?: CashReport; stale?: boolean; denied?: boolean; }
const EMPTY: CourierBoardState = { ready: false, stores: [] };
const getEmpty = () => EMPTY;
const noSubscribe = () => () => {};

export function SharedDeliveryBoard({ stores, userId }: { stores: CourierStore[]; userId: string }) {
  const { locale, t } = useLanguage();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [board, setBoard] = useState<DeliveryBoardEngine | null>(null);
  const [restaurantId, setRestaurantId] = useState('');
  const [stage, setStage] = useState<'ready' | 'mine' | 'cash'>('ready');
  const [focus, setFocus] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [cash, setCash] = useState<Record<string, CashResult>>({});
  const [cashLoading, setCashLoading] = useState(false);
  const [cashAuthError, setCashAuthError] = useState(false);
  const awake = useScreenAwake();
  const sound = useOrderSound();
  const soundRef = useRef(sound.play);
  soundRef.current = sound.play;
  const rootRef = useRef<HTMLElement>(null);
  const reportControllers = useRef(new Set<AbortController>());
  const activeReport = useRef<AbortController | null>(null);

  useEffect(() => {
    const engine = new DeliveryBoardEngine(stores, userId, () => {
      soundRef.current();
      try { navigator.vibrate?.([180, 100, 180]); } catch { /* Optional on phones. */ }
    }, () => localeRef.current);
    setBoard(engine);
    void engine.start();
    return () => engine.stop();
  }, [stores, userId]);

  const snapshot = useSyncExternalStore(board?.subscribe ?? noSubscribe, board?.getState ?? getEmpty, getEmpty);
  const expired = cashAuthError || snapshot.stores.some((entry) => entry.state.authError && !entry.state.accessDenied);
  const denied = useMemo(() => new Set([...snapshot.stores.filter((entry) => entry.state.accessDenied).map((entry) => entry.store.id), ...Object.entries(cash).filter(([, entry]) => entry.denied).map(([id]) => id)]), [snapshot, cash]);
  const visible = useMemo(() => ({ ...snapshot, stores: expired ? [] : snapshot.stores.filter((entry) => !denied.has(entry.store.id)) }), [snapshot, denied, expired]);
  const jobs = useMemo(() => courierOrders(visible, userId, restaurantId), [visible, userId, restaurantId]);
  const permittedStores = stores.filter((store) => !denied.has(store.id));
  const shownStores = expired ? [] : permittedStores.filter((store) => !restaurantId || store.id === restaurantId);
  const loaded = snapshot.stores.filter((entry) => entry.state.ready).length;
  const online = visible.stores.filter((entry) => entry.state.lastSyncAt && entry.state.connectivity !== 'offline' && !entry.state.authError).length;
  const connectionLabel = online === visible.stores.length && online > 0 ? t('متصل', 'Connected') : online > 0 ? t('اتصال جزئي', 'Partly connected') : visible.stores.some((entry) => entry.state.connectivity === 'syncing' && !entry.state.lastSyncAt) ? t('تحميل…', 'Loading…') : t('بلا إنترنت', 'Offline');
  const pending = visible.stores.reduce((sum, entry) => sum + entry.state.outboxCount, 0);
  const highlighted = [...jobs.ready, ...jobs.mine].filter((entry) => entry.highlighted).length;
  const rows = stage === 'ready' ? jobs.ready : jobs.mine;

  useEffect(() => {
    if (snapshot.stores.some((entry) => entry.state.authError && !entry.state.accessDenied)) setCash({});
  }, [snapshot]);

  useEffect(() => {
    if (restaurantId && !permittedStores.some((store) => store.id === restaurantId)) setRestaurantId('');
  }, [restaurantId, denied, stores]);

  const refreshCash = useCallback(async () => {
    if ((activeReport.current && !activeReport.current.signal.aborted) || !navigator.onLine || document.visibilityState === 'hidden') return;
    setCashLoading(true);
    const controller = new AbortController();
    activeReport.current = controller;
    reportControllers.current.add(controller);
    let nextIndex = 0;
    let authDenied = false;
    let verifiedIdentity = false;
    const denySession = () => {
      authDenied = true;
      setCash({});
      setCashAuthError(true);
      controller.abort();
    };
    const worker = async () => {
      while (nextIndex < stores.length && !controller.signal.aborted) {
        const store = stores[nextIndex++];
        try {
          const response = await fetch('/api/merchant/delivery-summary?restaurantId=' + encodeURIComponent(store.id) + '&actorUserId=' + encodeURIComponent(userId), { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
          if (controller.signal.aborted) return;
          if (response.status === 401) { denySession(); return; }
          if (response.status === 403) { setCash((current) => ({ ...current, [store.id]: { denied: true } })); continue; }
          if (!response.ok) throw new Error('summary-unavailable');
          const report = await response.json() as CashReport;
          if (controller.signal.aborted) return;
          if (report.viewerUserId !== userId) { denySession(); return; }
          verifiedIdentity = true;
          if (report.restaurantId !== store.id || !['cashCollected', 'cashOutstanding', 'ordersCompleted', 'cashPending', 'handedIn', 'cashRefunds', 'merchantShare', 'platformShare', 'serverTime'].every((key) => Number.isSafeInteger(report[key as keyof CashReport]))) throw new Error('invalid-summary');
          if (!controller.signal.aborted) setCash((current) => ({ ...current, [store.id]: { report } }));
        } catch { if (!controller.signal.aborted) setCash((current) => ({ ...current, [store.id]: { ...current[store.id], stale: true } })); }
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(4, stores.length) }, worker)); }
    finally { reportControllers.current.delete(controller); if (activeReport.current === controller) { activeReport.current = null; if (!controller.signal.aborted && verifiedIdentity) setCashAuthError(false); if (!controller.signal.aborted || authDenied) setCashLoading(false); } }
  }, [stores, userId]);

  useEffect(() => {
    void refreshCash();
    const timer = setInterval(() => void refreshCash(), 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshCash(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      reportControllers.current.forEach((controller) => controller.abort());
    };
  }, [refreshCash]);

  useEffect(() => {
    document.body.classList.toggle('merchant-focus-mode', focus);
    return () => document.body.classList.remove('merchant-focus-mode');
  }, [focus]);
  const toggleFocus = async () => {
    const next = !focus;
    setFocus(next);
    try { if (next) await rootRef.current?.requestFullscreen?.(); else if (document.fullscreenElement === rootRef.current) await document.exitFullscreen(); }
    catch { /* The compact focus layout also works without fullscreen support. */ }
  };
  useEffect(() => {
    const onFullscreen = () => { if (!document.fullscreenElement) setFocus(false); };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  async function act(row: CourierOrder, action: OrderAction) {
    if (expired) return false;
    setActionFailed(false);
    try {
      const saved = await board?.dispatch(row.store.id, row.order.id, action);
      if (saved) { board?.seen(row.store.id, row.order.id); if (action === 'OUT_FOR_DELIVERY') setStage('mine'); }
      else setActionFailed(true);
      return saved ?? false;
    } catch { setActionFailed(true); return false; }
  }

  return <main ref={rootRef} className={'shared-delivery ' + (focus ? 'is-focus' : '')}>
    <header className="shared-delivery-heading"><div><h1><Bike size={23} />{t('توصيل المطاعم', 'Restaurant deliveries')}</h1><small>{t('كل المطاعم المتاحة لحسابك', 'All restaurants assigned to you')} · {permittedStores.length}</small></div><label className="shared-store-select"><span className="sr-only">{t('عرض طلبات مطعم', 'Filter by restaurant')}</span><select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}><option value="">{t('كل المطاعم', 'All restaurants')}</option>{permittedStores.map((store) => <option key={store.id} value={store.id}>{localizedName(locale, store.nameAr, store.nameEn)}</option>)}</select></label></header>
    <div className="shared-delivery-tools"><button className={'shared-connection ' + (online ? 'is-online' : '')} onClick={() => { board?.refresh(); void refreshCash(); }} aria-label={t('تحديث كل المطاعم', 'Refresh all restaurants')}><RefreshCw size={15} />{connectionLabel}{pending > 0 && <b>{pending} {t('للمزامنة', 'pending')}</b>}</button><button className={'shared-tool ' + (sound.enabled ? 'is-on' : 'needs-enable')} onClick={sound.toggle} aria-pressed={sound.enabled} aria-label={sound.enabled ? t('كتم صوت الطلبات', 'Mute order sound') : t('تشغيل صوت الطلبات', 'Enable order sound')}>{sound.enabled ? <Volume2 size={20} /> : <VolumeX size={20} />}</button><button className="shared-tool" onClick={toggleFocus} aria-pressed={focus} aria-label={focus ? t('الخروج من العرض الكبير', 'Exit large view') : t('عرض كبير للطلبات', 'Large order view')}>{focus ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</button><details className="shared-device-menu"><summary className="shared-tool" aria-label={t('الصوت والشاشة', 'Sound and display')}><Settings2 size={20} /></summary><div><h2>{t('الصوت والشاشة', 'Sound and display')}</h2><button className="btn btn-primary w-full" onClick={sound.toggle} aria-pressed={sound.enabled}>{sound.enabled ? t('الصوت شغّال · اضغط للكتم', 'Sound on · tap to mute') : t('شغّل صوت الطلبات', 'Enable order sound')}</button><button className="btn btn-secondary mt-3 w-full" disabled={awake.supported !== true} onClick={awake.toggle} aria-pressed={awake.active}>{awake.active ? <Sun size={18} /> : <Moon size={18} />}{awake.active ? t('الشاشة هتفضل مفتوحة', 'Screen stays awake') : t('خلي الشاشة مفتوحة', 'Keep screen awake')}</button>{awake.supported === false && <p>{t('الهاتف لا يدعم تثبيت الشاشة هنا. راجع وقت قفل الشاشة في إعداداته.', 'Keeping the screen awake is unavailable here. Check your phone’s screen timeout.')}</p>}{awake.failed && <p role="status">{t('الهاتف لم يسمح بتثبيت الشاشة. جرّب مرة أخرى وراجع توفير البطارية.', 'The phone could not keep the screen awake. Retry and check battery-saving mode.')}</p>}{sound.failed && <p role="status">{t('الصوت لم يتفعّل. اضغط الزر مرة أخرى.', 'Sound could not be enabled. Tap the button again.')}</p>}</div></details></div>
    {expired && <p className="shared-warning" role="alert">{t('انتهت الجلسة. خطواتك محفوظة على الجهاز.', 'Your session expired. Your actions are saved on this device.')} <a href="/login?next=/merchant/delivery">{t('سجّل دخول من جديد', 'Sign in again')}</a></p>}
    {denied.size > 0 && <p className="shared-warning" role="status">{t('اتشال مطعم من صلاحيات حسابك، وطلباته اتخفت من الشاشة.', 'A restaurant was removed from your permissions. Its orders are hidden.')} <a href="/merchant/delivery">{t('تحديث الصلاحيات', 'Reload permissions')}</a></p>}
    {snapshot.stores.some((entry) => entry.error) && <p className="shared-warning" role="alert">{t('تعذر فتح الطلبات المحفوظة لأحد المطاعم. باقي المطاعم شغالة.', 'Saved orders could not be opened for one restaurant. Other restaurants remain available.')} <a href="/merchant/delivery">{t('إعادة المحاولة', 'Retry')}</a></p>}
    {actionFailed && <p className="shared-warning" role="alert">{t('الخطوة لم تُحفظ. راجع آخر حالة وحاول مرة أخرى.', 'The action was not saved. Check the latest status and try again.')}</p>}
    {visible.stores.map((entry) => entry.state.notice ? <p className="shared-warning" role="status" key={entry.store.id}>{localizedName(locale, entry.store.nameAr, entry.store.nameEn)}: {localizeMessage(entry.state.notice, locale)}</p> : null)}
    <div className="shared-delivery-tabs" role="group" aria-label={t('حالة التوصيل والحسابات', 'Delivery stages and cash')}><button className={stage === 'ready' ? 'is-active' : ''} aria-pressed={stage === 'ready'} onClick={() => setStage('ready')}>{t('جاهز للاستلام', 'Ready to collect')}<b>{jobs.ready.length}</b></button><button className={stage === 'mine' ? 'is-active' : ''} aria-pressed={stage === 'mine'} onClick={() => setStage('mine')}>{t('معايا في الطريق', 'My deliveries')}<b>{jobs.mine.length}</b></button><button className={stage === 'cash' ? 'is-active' : ''} aria-pressed={stage === 'cash'} onClick={() => { setStage('cash'); void refreshCash(); }}><Wallet size={19} />{t('حساباتي', 'My cash')}</button></div>
    {stage !== 'cash' && highlighted > 0 && <p className="shared-new-notice" role="status">{t(`${highlighted} طلب جديد أو تحديث محتاج انتباهك`, `${highlighted} new orders or updates need your attention`)}</p>}
    {stage === 'cash' ? <CourierCash stores={shownStores} results={cash} loading={cashLoading} refresh={refreshCash} /> : <div className="shared-delivery-jobs">{rows.map((row) => <SharedCourierCard key={row.store.id + ':' + row.order.id} row={row} onAction={act} onSeen={() => board?.seen(row.store.id, row.order.id)} />)}{!rows.length && <div className="shared-empty" role="status"><Bike size={34} /><h2>{!snapshot.ready && !loaded ? t('بنحمّل طلبات المطاعم…', 'Loading restaurant orders…') : stage === 'ready' ? t('مفيش طلبات جاهزة حاليًا', 'No ready orders right now') : t('مفيش طلبات معاك في الطريق', 'You have no deliveries in progress')}</h2><p>{t('الطلبات بتتحدث تلقائيًا لكل مطعم.', 'Orders update automatically for every restaurant.')}</p></div>}</div>}
  </main>;
}

function SharedCourierCard({ row, onAction, onSeen }: { row: CourierOrder; onAction: (row: CourierOrder, action: OrderAction) => Promise<boolean>; onSeen: () => void }) {
  const { locale, t } = useLanguage();
  const { order: order, store } = row;
  const [saving, setSaving] = useState(false);
  const action = primaryActionFor(order.status, order.fulfillment);
  const cash = order.paymentMethod === 'CASH' && order.paymentStatus !== 'PAYMENT_VERIFIED';
  const actionLabel = action === 'OUT_FOR_DELIVERY' ? t('استلمت الطلب · ابدأ التوصيل', 'Collected · start delivery') : action === 'MARK_ARRIVED' ? t('وصلت لنقطة التسليم', 'Arrived at destination') : cash ? t('سلّمت الطلب وحصّلت الكاش ✓', 'Delivered & collected cash ✓') : t('سلّمت الطلب للعميل ✓', 'Delivered to customer ✓');
  return <article className={'shared-courier-card ' + (row.highlighted ? 'is-new' : '')} onClick={onSeen} aria-label={t('طلب ', 'Order ') + order.orderNumber + ' · ' + localizedName(locale, store.nameAr, store.nameEn)}>
    <div className="shared-card-top"><strong dir="ltr">#{order.orderNumber}</strong>{row.highlighted && <span>{t('جديد', 'New')}</span>}</div>
    <p className="shared-from"><Bike size={17} /><span>{t('من ', 'From ')}<b>{localizedName(locale, store.nameAr, store.nameEn)}</b></span></p>
    <h2>{order.channel === 'COUNTER' && order.customerName === 'عميل المحل' ? t('عميل المحل', 'Walk-in customer') : order.customerName}</h2>
    {order.customerPhone && <a className="shared-customer-phone" href={'tel:' + order.customerPhone} onClick={(event) => event.stopPropagation()} aria-label={t('اتصل بالعميل ', 'Call customer ') + order.customerPhone}><span dir="ltr">{order.customerPhone}</span><span><Phone size={17} />{t('اتصال', 'Call')}</span></a>}
    <div className="shared-destination"><MapPin size={21} /><div><small>{t('التسليم في', 'Deliver to')}</small><strong>{localizedName(locale, order.deliveryPointName, order.deliveryPointNameEn)}</strong></div></div>
    <div className={'shared-cash-instruction ' + (cash ? 'collect' : 'paid')}>{cash ? <><small>{t('حصّل من العميل', 'Collect from customer')}</small><strong>{formatMoney(order.total, locale)} {t('كاش', 'cash')}</strong></> : <><strong>{t('مدفوع ✓', 'Paid ✓')}</strong><small>{t('متأخدش فلوس من العميل', 'No cash to collect')}</small></>}</div>
    {action && <button className="btn btn-primary shared-delivery-action" disabled={saving} onClick={async (event) => { event.stopPropagation(); setSaving(true); try { await onAction(row, action); } finally { setSaving(false); } }}>{saving ? t('بنحفظ الخطوة…', 'Saving action…') : actionLabel}</button>}
    {row.pending > 0 && <p className="shared-pending" role="status">{t('محفوظ على الجهاز · ينتظر المزامنة', 'Saved on device · awaiting sync')}</p>}
    <details className="shared-order-details" onClick={(event) => event.stopPropagation()}><summary>{t('الأصناف والملاحظات', 'Items & notes')} · {order.items.reduce((sum, item) => sum + item.quantity, 0)}</summary>{order.customerNote && <p className="shared-kitchen-note">📝 {order.customerNote}</p>}<ul>{order.items.map((item) => <li key={item.id}><b className="shared-item-quantity">{item.quantity}</b><div><strong>{localizedName(locale, item.nameAr, item.nameEn)}</strong>{item.variantNameAr && <p>{localizedName(locale, item.variantNameAr, item.variantNameEn)}</p>}{item.addons.length > 0 && <p>+ {item.addons.map((addon) => localizedName(locale, addon.nameAr, addon.nameEn)).join(locale === 'ar' ? '، ' : ', ')}</p>}{item.note && <p className="shared-kitchen-note">{item.note}</p>}</div></li>)}</ul><p className="mt-3 text-sm">{t('إجمالي الطلب', 'Order total')}: <b>{formatMoney(order.total, locale)}</b></p></details>
  </article>;
}

function CourierCash({ stores, results, loading, refresh }: { stores: CourierStore[]; results: Record<string, CashResult>; loading: boolean; refresh: () => Promise<void> }) {
  const { locale, t } = useLanguage();
  const rows = stores.map((store) => ({ store, ...results[store.id] }));
  const reports = rows.flatMap((row) => row.report ? [row.report] : []);
  const sum = (key: 'cashCollected' | 'cashOutstanding' | 'cashPending') => reports.reduce((total, report) => total + report[key], 0);
  return <section className="shared-cash-view"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">{t('حسابات التوصيل', 'Delivery cash')}</h2><p className="mt-1 text-xs text-gray-500">{t('اليوم حسب توقيت كل مطعم. العهدة تشمل الأيام السابقة.', 'Today follows each restaurant’s time zone. Cash held includes previous days.')}</p></div><button className="btn btn-secondary" disabled={loading} onClick={refresh}><RefreshCw size={17} className={loading ? 'animate-spin' : ''} />{t('تحديث', 'Refresh')}</button></div>
    <div className="shared-cash-totals"><div><small>{t('كاش معاك · لم يُسلّم للمطاعم', 'Cash held · not handed to restaurants')}</small><strong>{reports.length ? formatMoney(sum('cashOutstanding'), locale) : '—'}</strong></div><div><small>{t('كاش حصّلته النهارده', 'Cash collected today')}</small><strong>{reports.length ? formatMoney(sum('cashCollected'), locale) : '—'}</strong></div><div><small>{t('كاش لسه هتحصّله في الطلبات', 'Cash still to collect on orders')}</small><strong>{reports.length ? formatMoney(sum('cashPending'), locale) : '—'}</strong></div></div>
    {reports.length < stores.length && <p className="shared-warning" role="status">{t('الإجمالي المتاح يشمل المطاعم اللي وصل حسابها فقط.', 'Available totals include only restaurants whose reports have loaded.')}</p>}
    <div className="shared-cash-stores">{rows.map(({ store, report, stale }) => <article key={store.id}><h3>{localizedName(locale, store.nameAr, store.nameEn)}</h3>{report ? <><div className="shared-money-row"><span>{t('كاش معاك للمطعم · كل الأيام', 'Cash held for this restaurant · all days')}</span><b>{formatMoney(report.cashOutstanding, locale)}</b></div><div className="shared-money-row"><span>{t('تحصيل النهارده', 'Collected today')}</span><b>{formatMoney(report.cashCollected, locale)}</b></div><div className="shared-money-row"><span>{t('طلبات سلّمتها النهارده', 'Orders delivered today')}</span><b>{report.ordersCompleted}</b></div><details><summary>{t('تفاصيل الحساب', 'Cash details')}</summary><div className="shared-money-row"><span>{t('كاش لسه هتحصّله', 'Cash still to collect')}</span><b>{formatMoney(report.cashPending, locale)}</b></div><div className="shared-money-row"><span>{t('كاش سلّمته للمطعم · كل الأيام', 'Cash handed in · all days')}</span><b>{formatMoney(report.handedIn, locale)}</b></div><div className="shared-money-row"><span>{t('نصيب المطعم النهارده', 'Restaurant share today')}</span><b>{formatMoney(report.merchantShare, locale)}</b></div><div className="shared-money-row"><span>{t('نصيب المنصة النهارده', 'Platform share today')}</span><b>{formatMoney(report.platformShare, locale)}</b></div><div className="shared-money-row"><span>{t('مرتجعات كاش النهارده · حساب منفصل', 'Cash refunds today · recorded separately')}</span><b>{formatMoney(report.cashRefunds, locale)}</b></div><p className="mt-2 text-xs text-gray-500">{t('آخر تحديث', 'Last updated')}: {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: store.timezone, hour: '2-digit', minute: '2-digit' }).format(report.serverTime)}</p></details>{stale && <p className="mt-3 text-xs text-amber-800" role="status">{t('ده آخر حساب وصلنا. هنحدّثه عند رجوع الاتصال.', 'This is the last received report. It will refresh when connected.')}</p>}</> : <p className="mt-3 text-sm text-gray-500" role="status">{loading ? t('بنراجع حساب المطعم…', 'Loading this restaurant’s report…') : t('الحساب هيظهر عند الاتصال بالإنترنت.', 'The report will appear when connected.')}</p>}</article>)}</div>
  </section>;
}
