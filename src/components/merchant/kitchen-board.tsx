'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MerchantEngine, type EngineState } from '@/client/merchant/engine';
import { getPaperWidth, setPaperWidth, type PaperWidth } from '@/client/merchant/printing';
import { formatMoney, formatTime } from '@/lib/domain/misc';
import { isTerminal, primaryActionFor, transitionFor, type OrderAction, type OrderStatus } from '@/lib/domain/order-machine';
import { PAYMENT_STATUS_TONE } from '@/lib/labels';
import { useLanguage } from '@/components/language-provider';
import { labels, localizedName, localizeMessage, text, type Locale } from '@/lib/i18n';
import { startOfLocalDay } from '@/lib/domain/hours';
import type { OrderSnapshot, StoreLive } from '@/lib/types';
import { PrintPortal } from './receipt';
import { useScreenAwake } from './use-screen-awake';
import { Maximize2, Minimize2, Phone, Volume2, VolumeX, Sun, Moon, Settings2 } from 'lucide-react';
import './merchant-orders.css';

interface Props {
  userId: string;
  restaurant: { id: string; nameAr: string; nameEn: string; timezone: string };
  permissions: string[];
}

const EMPTY: EngineState = {
  ready: false,
  orders: [],
  pending: {},
  outboxCount: 0,
  connectivity: 'syncing',
  lastSyncAt: null,
  store: null,
  serverOffset: 0,
  authError: false,
  notice: null,
  highlighted: {},
};
const noopSubscribe = () => () => {};
const getEmpty = () => EMPTY;

const COLUMNS: { key: string; title: string; titleEn: string; statuses: OrderStatus[]; tone: string }[] = [
  { key: 'kitchen', title: 'في المطبخ', titleEn: 'Kitchen', statuses: ['CREATED', 'CONFIRMED', 'PREPARING'], tone: 'border-t-orange-500' },
  { key: 'payment', title: 'مراجعة الدفع', titleEn: 'Payments', statuses: ['PAYMENT_REVIEW', 'AWAITING_PAYMENT'], tone: 'border-t-amber-500' },
  { key: 'ready', title: 'جاهز', titleEn: 'Ready', statuses: ['READY'], tone: 'border-t-green-600' },
  { key: 'delivery', title: 'توصيل', titleEn: 'Delivery', statuses: ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE'], tone: 'border-t-purple-600' },
];
/** Delivery staff see only what concerns them: pick up from the kitchen, then deliver. */
const DELIVERY_COLUMNS: typeof COLUMNS = [
  { key: 'ready', title: 'جاهز للاستلام من المطبخ', titleEn: 'Ready to collect', statuses: ['READY'], tone: 'border-t-green-600' },
  { key: 'delivery', title: 'معايا في الطريق', titleEn: 'My deliveries', statuses: ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE'], tone: 'border-t-purple-600' },
];
const NEW_PRIORITY: Partial<Record<OrderStatus, number>> = { PAYMENT_REVIEW: 0, CREATED: 0, CONFIRMED: 1, AWAITING_PAYMENT: 2 };

function useChime() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [preferred, setPreferred] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    try { setPreferred(localStorage.getItem('merchant:sound-enabled') === '1'); } catch { /* private browsing */ }
    return () => { const ctx = ctxRef.current; if (ctx) { ctx.onstatechange = null; void ctx.close().catch(() => {}); } };
  }, []);

  const play = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    [0, 0.25, 0.5, 1.1, 1.35, 1.6].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i % 3 === 1 ? 1320 : 990;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.5, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.25);
    });
  }, []);

  const enable = useCallback(async () => {
    setFailed(false);
    try {
      if (ctxRef.current?.state === 'running') {
        await ctxRef.current.suspend();
        setEnabled(false);
        setPreferred(false);
        try { localStorage.setItem('merchant:sound-enabled', '0'); } catch { /* private browsing */ }
        return;
      }
      ctxRef.current ??= new AudioContext();
      const ctx = ctxRef.current;
      ctx.onstatechange = () => setEnabled(ctx.state === 'running');
      await ctx.resume();
      setEnabled(ctx.state === 'running');
      setPreferred(true);
      try { localStorage.setItem('merchant:sound-enabled', '1'); } catch { /* private browsing */ }
      play();
    } catch { setEnabled(false); setFailed(true); }
  }, [play]);

  return { enabled, preferred, failed, enable, play };
}

function ago(ms: number, locale: Locale) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 1 ? text(locale, 'الآن', 'Just now') : text(locale, `منذ ${m} د`, `${m} min ago`);
}
function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(Math.abs(ms) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function KitchenBoard({ restaurant, permissions, userId }: Props) {
  const { locale, t } = useLanguage();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const copy = labels(locale);
  const restaurantName = localizedName(locale, restaurant.nameAr, restaurant.nameEn);
  const perms = useMemo(() => new Set(permissions), [permissions]);
  const [engine, setEngine] = useState<MerchantEngine | null>(null);
  const chime = useChime();
  const alertRef = useRef<(orders: OrderSnapshot[]) => void>(() => {});
  const [now, setNow] = useState(() => Date.now());
  const deliveryOnly = permissions.includes('orders.delivery') && !permissions.includes('orders.view') && !permissions.includes('orders.kitchen');
  const columns = deliveryOnly ? DELIVERY_COLUMNS : COLUMNS;
  const [tab, setTab] = useState(deliveryOnly ? 'ready' : 'kitchen');
  const awake = useScreenAwake();
  const [focus, setFocus] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.classList.toggle('merchant-focus-mode', focus);
    return () => document.body.classList.remove('merchant-focus-mode');
  }, [focus]);
  const toggleFocus = async () => {
    const next = !focus;
    setFocus(next);
    try {
      if (next) await boardRef.current?.requestFullscreen?.();
      else if (document.fullscreenElement === boardRef.current) await document.exitFullscreen();
    } catch { /* Focus layout remains useful where fullscreen is unavailable. */ }
  };
  useEffect(() => {
    const onFullscreen = () => { if (!document.fullscreenElement) setFocus(false); };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);
  const [showUnpaid, setShowUnpaid] = useState(false);
  const [reasonFor, setReasonFor] = useState<{ order: OrderSnapshot; action: 'CANCEL' | 'REJECT_PAYMENT' } | null>(null);
  const [printing, setPrinting] = useState<OrderSnapshot | null>(null);
  const [paper, setPaper] = useState<PaperWidth>('80');
  const [startError, setStartError] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  useEffect(() => {
    const e = new MerchantEngine(restaurant.id, userId, perms, (o) => alertRef.current(o), () => localeRef.current);
    let disposed = false;
    setStartError(null);
    setEngine(e);
    e.start().catch((err) => { if (!disposed) setStartError(String(err?.message ?? err)); });
    return () => { disposed = true; e.stop(); };
  }, [restaurant.id, userId, perms]);

  useEffect(() => {
    setPaper(getPaperWidth());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  alertRef.current = (orders) => {
    chime.play();
    try {
      navigator.vibrate?.([200, 100, 200]);
      if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        for (const o of orders.slice(0, 3)) new Notification(`${t('طلب', 'Order')} #${o.orderNumber} — ${copy.status[o.status]}`, { body: `${o.channel === 'COUNTER' && o.customerName === 'عميل المحل' ? t('عميل المحل', 'Walk-in customer') : o.customerName} • ${formatMoney(o.total, locale)}`, tag: o.id });
      }
    } catch {
      /* ignore */
    }
  };

  const state = useSyncExternalStore(engine?.subscribe ?? noopSubscribe, engine?.getState ?? getEmpty, getEmpty);
  const serverNow = now + state.serverOffset;
  const highlightedCount = Object.keys(state.highlighted).length;

  useEffect(() => {
    document.title = highlightedCount ? `(${highlightedCount}) ${t('طلب جديد', 'New orders')} — ${restaurantName}` : `${t('الطلبات', 'Orders')} — ${restaurantName}`;
  }, [highlightedCount, restaurantName, locale, t]);

  const act = useCallback(
    async (order: OrderSnapshot, action: OrderAction, reason?: string) => {
      setActionFailed(false);
      try {
        const saved = await engine?.dispatch(order.id, action, reason ? { reason } : undefined);
        if (saved) engine?.unhighlight(order.id);
        return saved ?? false;
      } catch {
        setActionFailed(true);
        return false;
      }
    },
    [engine],
  );

  const active = state.orders.filter((o) => !isTerminal(o.status));
  const recentDone = state.orders
    .filter((o) => isTerminal(o.status))
    .sort((a, b) => (b.completedAt ?? b.cancelledAt ?? 0) - (a.completedAt ?? a.cancelledAt ?? 0))
    .slice(0, 8);

  // Courier money: cash to collect on the way + cash collected today (works offline from local data).
  const dayStart = startOfLocalDay(new Date(Date.now() + state.serverOffset), restaurant.timezone);
  const mine = state.orders.filter((o) => o.assignedToUserId === userId);
  const onTheWay = mine.filter((o) => o.status === 'OUT_FOR_DELIVERY' || o.status === 'ARRIVED_AT_GATE');
  const toCollect = onTheWay.filter((o) => o.paymentMethod === 'CASH' && o.paymentStatus !== 'PAYMENT_VERIFIED').reduce((s, o) => s + o.total, 0);
  const deliveredToday = mine.filter((o) => o.status === 'COMPLETED' && (o.completedAt ?? 0) >= dayStart.getTime());
  const cashCollected = deliveredToday.filter((o) => o.paymentMethod === 'CASH').reduce((s, o) => s + o.total, 0);
  const showCourierStrip = perms.has('orders.delivery') && (deliveryOnly || mine.length > 0);

  const columnOrders = (statuses: OrderStatus[]) =>
    active
      .filter((o) => statuses.includes(o.status))
      .sort((a, b) => (NEW_PRIORITY[a.status] ?? 0) - (NEW_PRIORITY[b.status] ?? 0) || a.createdAt - b.createdAt);

  if (startError) {
    return <div role="alert" className="m-4 space-y-3 rounded-2xl bg-red-50 p-4 text-red-800">
      <p>{t('تعذر حفظ الطلبات على هذا الجهاز. حاول إعادة تحميل الصفحة أو استخدام متصفح آخر.', 'This device cannot save orders. Reload the page or try another browser.')}</p>
      <button className="btn btn-secondary" onClick={() => window.location.reload()}>{t('إعادة المحاولة', 'Try again')}</button>
    </div>;
  }

  return (
    <div ref={boardRef} className={'merchant-board flex min-h-[calc(100dvh-120px)] flex-col ' + (focus ? 'is-focus ' : '') + (deliveryOnly ? 'is-courier' : '')}>
      <TopBar
        state={state}
        canCreateOrders={perms.has('orders.create')}
        restaurantId={restaurant.id}
        canChangeStatus={perms.has('store.status')}
        onStore={(s) => engine?.setStore(s)}
        soundEnabled={chime.enabled}
        enableSound={chime.enable}
        soundPreferred={chime.preferred}
        soundFailed={chime.failed}
        awake={awake}
        focus={focus}
        toggleFocus={toggleFocus}
        paper={paper}
        setPaper={(w) => {
          setPaperWidth(w);
          setPaper(w);
        }}
        onSync={() => engine?.syncNow()}
      />

      {state.authError && (
        <div className="bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white">
          {t('انتهت الجلسة. الطلبات محفوظة على الجهاز.', 'Your session expired. Orders are saved on this device.')} <a className="underline" href="/login?next=/merchant">{t('سجّل دخول مرة أخرى', 'Sign in again')}</a>
        </div>
      )}
      {actionFailed && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-red-100 px-4 py-3 text-sm text-red-900">
          <span>{t('تعذر حفظ الخطوة على هذا الجهاز. حاول مرة أخرى.', 'This device could not save your action. Try again.')}</span>
          <button className="btn btn-ghost btn-sm" aria-label={t('إغلاق التنبيه', 'Dismiss notice')} onClick={() => setActionFailed(false)}>✕</button>
        </div>
      )}
      {state.notice && (
        <div className="flex items-center justify-between bg-amber-100 px-4 py-2 text-sm text-amber-900">
          <span>{localizeMessage(state.notice, locale)}</span>
          <button className="btn btn-ghost btn-sm" aria-label={t('إغلاق التنبيه', 'Dismiss notice')} onClick={() => engine?.clearNotice()}>✕</button>
        </div>
      )}
      {state.store?.status === 'PAUSED' && state.store.reason === 'CAPACITY' && (
        <div className="bg-red-100 px-4 py-2 text-center text-sm font-semibold text-red-800">{t('المطبخ وصل للحد الأقصى — الطلبات الجديدة متوقفة تلقائيًا لحد ما الضغط يخف', 'The kitchen is full. New orders will resume automatically when it is less busy.')}</div>
      )}

      {showCourierStrip && (
        <div className="merchant-courier-totals">
          <div><small>{t('معك في الطريق', 'With you now')}</small><b>{onTheWay.length} {t('طلب', 'orders')}</b></div>
          <div><small>{t('كاش مطلوب تحصيله', 'Cash to collect')}</small><b>{formatMoney(toCollect, locale)}</b></div>
          <details><summary className="cursor-pointer py-1 text-sm">{t('تسليمات اليوم', 'Today’s deliveries')}</summary><p className="mt-2 text-sm">{deliveredToday.length} {t('طلب تم تسليمه', 'delivered')} · {t('كاش تم تحصيله', 'Cash collected')}: {formatMoney(cashCollected, locale)}</p></details>
        </div>
      )}

      {highlightedCount > 0 && <div className="merchant-new-orders" role="status"><span>{t(`${highlightedCount} طلب محتاج انتباهك`, `${highlightedCount} orders need your attention`)}</span><button className="btn btn-secondary btn-sm" onClick={() => {
        const highlighted = active.find((o) => state.highlighted[o.id]);
        const target = columns.find((c) => highlighted && c.statuses.includes(highlighted.status));
        if (target) setTab(target.key);
      }}>{t('عرض الطلبات', 'View orders')}</button></div>}

      {/* Mobile tabs */}
      <div className={'merchant-order-tabs ' + (deliveryOnly ? 'is-courier' : '')} role="group" aria-label={t('مراحل الطلبات', 'Order stages')}>
        {columns.map((c) => (
          <button key={c.key} className={tab === c.key ? 'is-selected' : ''} aria-pressed={tab === c.key} onClick={() => setTab(c.key)}>
            <span>{t(c.title, c.titleEn)}</span><b>{columnOrders(c.statuses).length}</b>
          </button>
        ))}
      </div>

      {!state.ready ? (
        <div className={'merchant-board-grid flex-1 ' + (deliveryOnly ? 'is-courier' : '')}>
          {columns.map((c) => <div key={c.key} className="skeleton h-64" />)}
        </div>
      ) : (
        <div className={'merchant-board-grid flex-1 ' + (deliveryOnly ? 'is-courier' : '')}>
          {columns.map((c) => {
            const list = columnOrders(c.statuses);
            const unpaid = c.key === 'payment' ? list.filter((o) => o.status === 'AWAITING_PAYMENT') : [];
            const shown = c.key === 'payment' ? list.filter((o) => o.status !== 'AWAITING_PAYMENT') : list;
            return (
              <section key={c.key} className={`merchant-order-column ${tab === c.key ? 'block' : 'hidden'} ${c.tone}`}>
                <h2 className="merchant-column-heading">
                  {t(c.title, c.titleEn)}
                  <span className="badge bg-white text-gray-800">{shown.length}</span>
                </h2>
                {c.key === 'ready' && perms.has('orders.delivery') && shown.filter((o) => o.fulfillment !== 'PICKUP').length > 1 && (
                  <div className="px-2 pb-2">
                    <button
                      className="btn btn-primary w-full"
                      onClick={async () => {
                        // One delivery run; pickup orders stay at the counter. Each order is still its own synced action.
                        for (const o of shown) if (o.fulfillment !== 'PICKUP') await act(o, 'OUT_FOR_DELIVERY');
                      }}
                    >
                      🛵 {t(`استلام كل الجاهز للتوصيل (${shown.filter((o) => o.fulfillment !== 'PICKUP').length})`, `Collect all ready deliveries (${shown.filter((o) => o.fulfillment !== 'PICKUP').length})`)}
                    </button>
                  </div>
                )}
                <div className="merchant-column-content">
                  {shown.map((o) => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      now={serverNow}
                      pending={state.pending[o.id] ?? 0}
                      highlighted={!!state.highlighted[o.id]}
                      perms={perms}
                      timezone={restaurant.timezone}
                      onAction={act}
                      onReason={(action) => setReasonFor({ order: o, action })}
                      onPrint={() => setPrinting(o)}
                      onSeen={() => engine?.unhighlight(o.id)}
                    />
                  ))}
                  {shown.length === 0 && unpaid.length === 0 && <p className="merchant-empty-orders">{t('لا يوجد', 'No orders')}</p>}
                  {unpaid.length > 0 && (
                    <div className="rounded-xl bg-white/60 p-2">
                      <button className="btn btn-ghost btn-sm w-full justify-between" onClick={() => setShowUnpaid((v) => !v)}>
                        <span>{t('بانتظار تحويل العميل', 'Awaiting customer payment')} ({unpaid.length})</span>
                        <span>{showUnpaid ? '▲' : '▼'}</span>
                      </button>
                      {showUnpaid && (
                        <div className="mt-2 space-y-2">
                          {unpaid.map((o) => (
                            <OrderCard
                              key={o.id}
                              order={o}
                              now={serverNow}
                              pending={state.pending[o.id] ?? 0}
                              highlighted={false}
                              perms={perms}
                              timezone={restaurant.timezone}
                              onAction={act}
                              onReason={(action) => setReasonFor({ order: o, action })}
                              onPrint={() => setPrinting(o)}
                              onSeen={() => {}}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {recentDone.length > 0 && (
        <details className="mx-3 mb-3 rounded-2xl bg-white p-3 ring-1 ring-gray-200">
          <summary className="cursor-pointer text-sm font-bold">{t('آخر الطلبات المنتهية', 'Recent finished orders')} ({recentDone.length})</summary>
          <div className="mt-2 divide-y divide-gray-100">
            {recentDone.map((o) => (
              <div key={o.id} className="merchant-finished-row">
                <span className="font-bold" dir="ltr">#{o.orderNumber}</span>
                <span className="flex-1 truncate">{o.channel === 'COUNTER' && o.customerName === 'عميل المحل' ? t('عميل المحل', 'Walk-in customer') : o.customerName}</span>
                <span className={`badge ${o.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>{copy.status[o.status]}</span>
                <span>{formatMoney(o.total, locale)}</span>
                {perms.has('receipts.print') && <button className="btn btn-secondary btn-sm" onClick={() => setPrinting(o)}>🖨️ {t('إعادة طباعة', 'Reprint')}</button>}
              </div>
            ))}
          </div>
        </details>
      )}

      {reasonFor && (
        <ReasonDialog
          title={`${reasonFor.action === 'CANCEL' ? t('إلغاء الطلب', 'Cancel order') : t('رفض التحويل', 'Reject payment')} #${reasonFor.order.orderNumber}`}
          placeholder={reasonFor.action === 'CANCEL' ? t('سبب الإلغاء', 'Reason for cancellation') : t('مثلاً: التحويل لم يصل. راجع رقم العملية.', 'For example: transfer not received. Check the reference.')}
          confirmLabel={reasonFor.action === 'CANCEL' ? t('إلغاء الطلب', 'Cancel order') : t('رفض التحويل', 'Reject payment')}
          onCancel={() => setReasonFor(null)}
          onConfirm={async (reason) => {
            if (await act(reasonFor.order, reasonFor.action, reason)) setReasonFor(null);
          }}
        />
      )}
      {printing && <PrintPortal order={printing} restaurantName={restaurantName} timezone={restaurant.timezone} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function TopBar({
  state, canCreateOrders, restaurantId, canChangeStatus, onStore,
  soundEnabled, soundPreferred, soundFailed, enableSound, awake, focus, toggleFocus,
  paper, setPaper, onSync,
}: {
  state: EngineState;
  canCreateOrders: boolean;
  restaurantId: string;
  canChangeStatus: boolean;
  onStore: (s: StoreLive) => void;
  soundEnabled: boolean;
  soundPreferred: boolean;
  soundFailed: boolean;
  enableSound: () => void;
  awake: ReturnType<typeof useScreenAwake>;
  focus: boolean;
  toggleFocus: () => void;
  paper: PaperWidth;
  setPaper: (w: PaperWidth) => void;
  onSync: () => void;
}) {
  const { locale, t } = useLanguage();
  const copy = labels(locale);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const store = state.store;
  const conn = {
    online: { text: t('متصل', 'Connected'), tone: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
    synced: { text: t('تم حفظ التحديثات', 'Updates saved'), tone: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
    syncing: { text: t('جاري الحفظ…', 'Saving…'), tone: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500 animate-pulse' },
    offline: { text: t('بدون إنترنت · محفوظ على الجهاز', 'Offline · saved on device'), tone: 'bg-amber-100 text-amber-900', dot: 'bg-amber-500' },
  }[state.connectivity];
  const levelTone = { NORMAL: 'bg-green-600', BUSY: 'bg-amber-500', HEAVY: 'bg-red-600', FULL: 'bg-red-700' };

  async function setStatus(status: 'OPEN' | 'PAUSED' | 'CLOSED') {
    setBusy(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/merchant/store-status', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ restaurantId, status }),
      });
      const data = (await res.json()) as { store?: StoreLive; error?: { message: string } };
      if (res.ok && data.store) onStore(data.store);
      else setStatusError(localizeMessage(data.error?.message ?? t('تعذر التغيير', 'Could not change the status'), locale));
    } catch { setStatusError(t('اتصل بالإنترنت لتغيير حالة المطعم.', 'Connect to the internet to change the restaurant status.')); }
    finally { setBusy(false); }
  }

  return <div className="merchant-order-toolbar">
    <div className="merchant-compact-toolbar">
      {store && <span className={`badge ${store.status === 'OPEN' ? 'bg-green-100 text-green-800' : store.status === 'BUSY' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>{copy.storeStatus[store.status]}</span>}
      <button className={`badge merchant-connection ${conn.tone}`} onClick={onSync} aria-label={t('تحديث الطلبات الآن', 'Refresh orders now')} title={conn.text}><span className={`size-2 shrink-0 rounded-full ${conn.dot}`} /><span>{state.connectivity === 'offline' ? t('بلا إنترنت', 'Offline') : state.connectivity === 'syncing' ? t('مزامنة…', 'Syncing…') : t('متصل', 'Connected')}</span>{state.outboxCount > 0 && <b>{state.outboxCount}</b>}</button>
      <button className={'merchant-tool-button ' + (soundEnabled ? 'sound-on' : 'sound-off')} aria-label={soundEnabled ? t('كتم صوت الطلبات', 'Mute order sound') : t('تشغيل صوت الطلبات', 'Enable order sound')} title={soundEnabled ? t('الصوت شغّال', 'Sound on') : t('تشغيل صوت الطلبات', 'Enable order sound')} aria-pressed={soundEnabled} onClick={enableSound}>{soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}</button>
      <button className="merchant-tool-button" aria-label={focus ? t('رجوع للشاشة العادية', 'Exit focus view') : t('عرض كبير للطلبات', 'Large order view')} title={focus ? t('رجوع', 'Exit focus') : t('عرض كبير', 'Large view')} aria-pressed={focus} onClick={toggleFocus}>{focus ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</button>
      <details className="merchant-tools-menu">
        <summary className="merchant-tool-button" aria-label={t('الصوت والشاشة وإعدادات التشغيل', 'Sound, display and workspace settings')} title={t('الصوت والشاشة', 'Sound and display')}><Settings2 size={20} /></summary>
        <div className="merchant-tools-panel">
          <h2 className="mb-3 text-base font-bold">{t('الصوت والشاشة', 'Sound and display')}</h2>
          <div className="merchant-device-controls" role="group" aria-label={t('الصوت والشاشة', 'Sound and display')}>
            <button className={'btn ' + (soundEnabled ? 'btn-secondary' : 'btn-primary')} aria-pressed={soundEnabled} onClick={enableSound}>{soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}{soundEnabled ? t('الصوت شغّال', 'Sound on') : soundPreferred ? t('شغّل الصوت هنا', 'Resume sound here') : t('شغّل صوت الطلبات', 'Enable order sound')}</button>
            <button className="btn btn-secondary" aria-pressed={awake.active} disabled={awake.supported !== true} onClick={awake.toggle}>{awake.active ? <Sun size={18} /> : <Moon size={18} />}{awake.active ? t('الشاشة هتفضل مفتوحة', 'Screen stays awake') : awake.wanted ? t('إعادة تثبيت الشاشة', 'Keep screen awake again') : t('خلي الشاشة مفتوحة', 'Keep screen awake')}</button>
          </div>
          {soundFailed && <p className="mt-2 text-xs text-amber-800" role="status">{t('المتصفح لم يسمح بالصوت. اضغط تفعيل الصوت مرة أخرى.', 'The browser could not enable sound. Tap the sound button again.')}</p>}
          {awake.supported === false && <p className="mt-2 text-xs text-gray-500">{t('تثبيت الشاشة غير مدعوم هنا. تقدر تطوّل وقت قفل الشاشة من إعدادات الهاتف.', 'Keeping the screen awake is unavailable here. Increase the screen timeout in your phone settings.')}</p>}
          {awake.failed && <p className="mt-2 text-xs text-amber-800" role="status">{t('الهاتف لم يسمح بتثبيت الشاشة. جرّب الزر مرة أخرى، وراجع وضع توفير البطارية.', 'The phone could not keep the screen awake. Try again and check battery-saving mode.')}</p>}
          {awake.wanted && !awake.active && !awake.failed && <p className="mt-2 text-xs text-amber-800" role="status">{t('الشاشة مش مثبتة حاليًا؛ فعّلها تاني لو الهاتف وقفها.', 'The screen is not currently kept awake; enable it again if the phone released it.')}</p>}
          {store && <p className="mt-4 text-sm text-gray-600">{t('ضغط المطبخ', 'Kitchen workload')}: {copy.loadLevel[store.level]} · {t(`الطلب الجديد حوالي ${store.etaMinutes} دقيقة`, `New orders take about ${store.etaMinutes} min`)}</p>}
          {canChangeStatus && store && store.reason !== 'INACTIVE' && <div className="mt-4"><label className="label">{t('استقبال الطلبات', 'Order availability')}</label><div className="merchant-availability" role="group" aria-label={t('استقبال الطلبات', 'Order availability')}>{(['OPEN', 'PAUSED', 'CLOSED'] as const).map((status) => <button key={status} disabled={busy || state.connectivity === 'offline'} aria-pressed={store.orderingStatus === status} onClick={() => setStatus(status)} className={store.orderingStatus === status ? 'bg-gray-900 text-white' : 'bg-white'}>{status === 'OPEN' ? t('✓ استقبال', '✓ Open') : status === 'PAUSED' ? t('Ⅱ توقف مؤقت', 'Ⅱ Pause') : t('× إغلاق', '× Close')}</button>)}</div></div>}
          <label className="mt-4 block"><span className="label">{t('عرض ورق الطابعة', 'Printer paper width')}</span><select className="input" value={paper} onChange={(e) => setPaper(e.target.value as PaperWidth)}><option value="80">{t('80 مم', '80 mm')}</option><option value="58">{t('58 مم', '58 mm')}</option></select></label>
          {state.lastSyncAt && <p className="mt-3 text-xs text-gray-500">{t('آخر تحديث', 'Last updated')}: {formatTime(state.lastSyncAt, Intl.DateTimeFormat().resolvedOptions().timeZone, locale)}</p>}
        </div>
      </details>
    </div>
    {canChangeStatus && store && store.orderingStatus !== 'OPEN' && store.reason !== 'INACTIVE' && <button className="btn btn-primary mt-3 w-full" disabled={busy || state.connectivity === 'offline'} onClick={() => setStatus('OPEN')}>{t('فتح استقبال الطلبات', 'Open ordering')}</button>}
    {statusError && <p role="alert" className="mt-2 text-sm text-red-600">{statusError}</p>}
  </div>;
}

function OrderCard({
  order: o,
  now,
  pending,
  highlighted,
  perms,
  timezone,
  onAction,
  onReason,
  onPrint,
  onSeen,
}: {
  order: OrderSnapshot;
  now: number;
  pending: number;
  highlighted: boolean;
  perms: ReadonlySet<string>;
  timezone: string;
  onAction: (o: OrderSnapshot, a: OrderAction) => Promise<boolean>;
  onReason: (a: 'CANCEL' | 'REJECT_PAYMENT') => void;
  onPrint: () => void;
  onSeen: () => void;
}) {
  const { locale, t } = useLanguage();
  const copy = labels(locale);
  const pickup = o.fulfillment === 'PICKUP';
  const primary = primaryActionFor(o.status, o.fulfillment);
  const primaryDef = primary ? transitionFor(primary, o.fulfillment) : null;
  const canPrimary = !!primaryDef && (perms.has(primaryDef.permission) || perms.has('*'));
  const kitchenPhase = o.status === 'CONFIRMED' || o.status === 'PREPARING';
  const readyIn = o.estimatedReadyAt ? o.estimatedReadyAt - now : null;
  const arriveIn = o.estimatedArrivalAt ? o.estimatedArrivalAt - now : null;
  const primaryTone =
    primary === 'VERIFY_PAYMENT' || primary === 'ACCEPT' ? 'btn-success' : primary === 'MARK_READY' ? 'btn-success' : primary === 'COMPLETE' ? 'btn-dark' : 'btn-primary';

  const [saving, setSaving] = useState(false);
  const primaryLabel = primary === 'MARK_READY' ? t('الطلب جاهز ✓', 'Order ready ✓') : primary === 'OUT_FOR_DELIVERY' ? t('استلام الطلب وبدء التوصيل', 'Collect & start delivery') : primary === 'MARK_ARRIVED' ? t('وصلت لنقطة الاستلام', 'Arrived at collection point') : primary === 'COMPLETE' ? pickup ? t('سلّمت الطلب للعميل ✓', 'Handed to customer ✓') : t('سلّمت الطلب وحصّلت الحساب ✓', 'Delivered & settled ✓') : primary ? copy.action[primary] : '';

  return <article onClick={onSeen} className={'merchant-order-card ' + (kitchenPhase ? 'is-kitchen ' : '') + (highlighted ? 'is-new ' : '') + (o.status === 'AWAITING_PAYMENT' ? 'is-unpaid' : '')} aria-label={t('طلب رقم ', 'Order ') + o.orderNumber}>
    <div className="merchant-order-heading">
      <div><div className="merchant-order-number" dir="ltr">#{o.orderNumber}</div><div className="merchant-order-age mt-2 text-xs text-gray-500">{ago(now - o.createdAt, locale)} · {formatTime(o.createdAt, timezone, locale)}</div></div>
      {highlighted && <span className="badge bg-amber-400 px-3 py-1 text-sm text-black">{t('طلب جديد', 'New order')}</span>}
    </div>
    <div className="merchant-order-badges">
      <span className={`badge ${pickup ? 'bg-orange-100 text-orange-900' : 'bg-sky-100 text-sky-900'}`}>{pickup ? t('🏪 استلام من المحل', '🏪 Restaurant pickup') : t('🛵 توصيل', '🛵 Delivery')}{o.channel === 'COUNTER' ? t(' · كاشير', ' · Counter') : t(' · أونلاين', ' · Online')}</span>
      <span className={`badge ${PAYMENT_STATUS_TONE[o.paymentStatus]}`}>{copy.paymentMethod[o.paymentMethod]} · {copy.paymentStatus[o.paymentStatus]}</span>
      {pending > 0 && <span className="badge bg-blue-100 text-blue-800">{t('محفوظ على الجهاز · ينتظر المزامنة', 'Saved on device · awaiting sync')}</span>}
    </div>
    <div className="merchant-order-customer"><small className="text-xs text-gray-500">{t('العميل', 'Customer')}</small><strong>{o.channel === 'COUNTER' && o.customerName === 'عميل المحل' ? t('عميل المحل', 'Walk-in customer') : o.customerName}</strong>
      {o.customerPhone && <a href={`tel:${o.customerPhone}`} className="merchant-order-phone" onClick={(event) => event.stopPropagation()} aria-label={t('اتصل بالعميل ', 'Call customer ') + o.customerPhone}><span dir="ltr">{o.customerPhone}</span><small><Phone size={17} />{t('اتصال', 'Call')}</small></a>}
    </div>
    <ul className="merchant-order-items" aria-label={t('الأصناف والكميات', 'Items and quantities')}>{o.items.map((item) => <li key={item.id}><span className="merchant-item-quantity" aria-label={t('الكمية ', 'Quantity ') + item.quantity}>{item.quantity}</span><div><strong className="merchant-item-name">{localizedName(locale, item.nameAr, item.nameEn)}</strong>{item.variantNameAr && <span className="merchant-item-options">{localizedName(locale, item.variantNameAr, item.variantNameEn)}</span>}{item.addons.length > 0 && <span className="merchant-item-options">+ {item.addons.map((a) => localizedName(locale, a.nameAr, a.nameEn)).join(locale === 'ar' ? '، ' : ', ')}</span>}{item.note && <p className="merchant-item-note">{item.note}</p>}</div></li>)}</ul>
    {o.customerNote && <p className="merchant-item-note mt-3">📝 {o.customerNote}</p>}
    <div className="merchant-order-destination"><small>{pickup ? t('الاستلام من المحل', 'Collect at the restaurant') : t('نقطة التسليم', 'Delivery destination')}</small><strong>{localizedName(locale, o.deliveryPointName, o.deliveryPointNameEn)}</strong>{o.assignedToName && <p className="merchant-assigned-courier mt-2 text-sm text-purple-800">{t('مسؤول التوصيل', 'Courier')}: {o.assignedToName}</p>}</div>
    <div className="merchant-order-total"><span>{t('الإجمالي', 'Total')}</span><strong>{formatMoney(o.total, locale)}</strong></div>
    {o.paymentReference && <p className="mt-2 break-all text-sm text-gray-600">{t('رقم التحويل', 'Transfer reference')}: <b dir="ltr">{o.paymentReference}</b></p>}
    {(o.status === 'READY' || o.status === 'OUT_FOR_DELIVERY' || o.status === 'ARRIVED_AT_GATE') && (o.paymentMethod === 'CASH' && o.paymentStatus !== 'PAYMENT_VERIFIED' ? <div className="merchant-order-collection mt-3 rounded-xl bg-amber-100 px-3 py-3 text-center text-xl font-black text-amber-900">{t('حصّل ', 'Collect ')}{formatMoney(o.total, locale)} {t('كاش', 'cash')}</div> : <div className="merchant-order-collection mt-3 rounded-xl bg-green-50 px-3 py-2 text-center text-base font-bold text-green-800">{t('مدفوع ✓ · متحصّلش فلوس', 'Paid ✓ · no cash to collect')}</div>)}
    {o.hasPaymentAttachment && perms.has('payments.verify') && <a href={`/api/merchant/orders/${o.id}/attachment`} target="_blank" rel="noreferrer" className="btn btn-secondary mt-3 min-h-12 w-full" onClick={(event) => event.stopPropagation()}>📎 {t('عرض صورة التحويل', 'View payment proof')}</a>}
    {o.status === 'AWAITING_PAYMENT' && <p className="mt-3 text-sm leading-relaxed text-gray-600">{t('مستنيين تحويل العميل. أكّد الدفع فقط بعد التأكد إن التحويل وصلك.', 'Waiting for the customer’s transfer. Verify only after confirming that the money arrived.')}</p>}
    {kitchenPhase && readyIn !== null && <div className={`merchant-order-timing mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-3 ${readyIn >= 0 ? 'bg-orange-50 text-orange-800' : 'bg-red-100 text-red-700'}`}><span className="text-sm font-bold">{readyIn >= 0 ? t('التجهيز خلال', 'Preparation in') : t('متأخر عن المتوقع', 'Past estimate')}</span><b className="font-mono text-2xl font-black" dir="ltr">{mmss(readyIn)}</b></div>}
    {o.status === 'CONFIRMED' && !o.estimatedReadyAt && <p className="mt-3 text-center text-sm text-gray-500">{t('الوقت المتوقع هيظهر بعد المزامنة', 'Estimated timing will appear after syncing')}</p>}
    {!pickup && (o.status === 'READY' || o.status === 'OUT_FOR_DELIVERY') && arriveIn !== null && <p className="merchant-delivery-estimate mt-3 text-center text-sm text-gray-600">{t('وصول متوقع خلال', 'Estimated arrival in')}: <b dir="ltr">{arriveIn >= 0 ? mmss(arriveIn) : '+' + mmss(arriveIn)}</b></p>}
    {canPrimary && primary && <button className={`btn merchant-order-primary mt-4 w-full ${primaryTone}`} disabled={saving} onClick={async (event) => { event.stopPropagation(); setSaving(true); try { await onAction(o, primary); } finally { setSaving(false); } }}>{saving ? t('بنحفظ الخطوة…', 'Saving action…') : primaryLabel}{primary === 'VERIFY_PAYMENT' ? ` (${formatMoney(o.total, locale)})` : ''}</button>}
    <details className="mt-2" onClick={(event) => event.stopPropagation()}><summary className="cursor-pointer rounded-lg px-2 py-3 text-sm font-semibold text-gray-600">{t('طباعة وخيارات أخرى', 'Print & more options')}</summary><div className="mt-2 grid gap-2">
      {o.status === 'PAYMENT_REVIEW' && perms.has('payments.verify') && <button className="btn btn-secondary min-h-12" disabled={saving} onClick={() => onReason('REJECT_PAYMENT')}>{t('رفض التحويل', 'Reject payment')}</button>}
      {o.status === 'OUT_FOR_DELIVERY' && perms.has('orders.delivery') && <button className="btn btn-secondary min-h-12" disabled={saving} onClick={() => onAction(o, 'COMPLETE')}>{t('تم التسليم مباشرة', 'Delivered directly')}</button>}
      {perms.has('receipts.print') && <button className="btn btn-secondary min-h-12" onClick={onPrint}>🖨️ {t('طباعة', 'Print')}</button>}
      {perms.has('orders.cancel') && <button className="btn btn-ghost min-h-12 text-red-600" disabled={saving} onClick={() => onReason('CANCEL')}>{t('إلغاء الطلب', 'Cancel order')}</button>}
    </div></details>
  </article>;
}

function ReasonDialog({
  title,
  placeholder,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  placeholder: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="reason-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4">
        <h3 id="reason-title" className="mb-3 text-lg font-bold">{title}</h3>
        <label className="label" htmlFor="order-reason">{t('السبب', 'Reason')}</label>
        <textarea id="order-reason" className="input min-h-24" placeholder={placeholder} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onCancel}>{t('رجوع', 'Back')}</button>
          <button className="btn btn-danger" onClick={() => onConfirm(reason.trim())}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
