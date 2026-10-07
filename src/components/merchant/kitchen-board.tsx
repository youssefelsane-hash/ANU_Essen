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
  { key: 'new', title: 'جديد', titleEn: 'New', statuses: ['CREATED', 'PAYMENT_REVIEW', 'CONFIRMED', 'AWAITING_PAYMENT'], tone: 'border-t-amber-500' },
  { key: 'preparing', title: 'بيتحضر', titleEn: 'Preparing', statuses: ['PREPARING'], tone: 'border-t-orange-500' },
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
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

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
    try {
      ctxRef.current ??= new AudioContext();
      await ctxRef.current.resume();
      setEnabled(true);
      play();
    } catch {
      /* audio unavailable */
    }
    try {
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    } catch {
      /* ignore */
    }
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      wakeLock.current = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      /* keep-awake not supported */
    }
  }, [play]);

  return { enabled, enable, play };
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
  const [tab, setTab] = useState(deliveryOnly ? 'ready' : 'new');
  const [showUnpaid, setShowUnpaid] = useState(false);
  const [reasonFor, setReasonFor] = useState<{ order: OrderSnapshot; action: 'CANCEL' | 'REJECT_PAYMENT' } | null>(null);
  const [printing, setPrinting] = useState<OrderSnapshot | null>(null);
  const [paper, setPaper] = useState<PaperWidth>('80');
  const [startError, setStartError] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  useEffect(() => {
    const e = new MerchantEngine(restaurant.id, userId, perms, (o) => alertRef.current(o), () => localeRef.current);
    setEngine(e);
    e.start().catch((err) => setStartError(String(err?.message ?? err)));
    return () => e.stop();
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
        for (const o of orders.slice(0, 3)) new Notification(`${t('طلب', 'Order')} #${o.orderNumber} — ${copy.status[o.status]}`, { body: `${o.customerName} • ${formatMoney(o.total, locale)}`, tag: o.id });
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
    <div className="flex min-h-[calc(100dvh-120px)] flex-col">
      <TopBar
        state={state}
        canCreateOrders={perms.has('orders.create')}
        restaurantId={restaurant.id}
        canChangeStatus={perms.has('store.status')}
        onStore={(s) => engine?.setStore(s)}
        soundEnabled={chime.enabled}
        enableSound={chime.enable}
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-purple-50 px-4 py-2 text-sm text-purple-950">
          <span>🛵 {t('معك الآن', 'With you now')}: <b>{onTheWay.length}</b> {t('طلب', 'orders')}</span>
          <span>{t('كاش للتحصيل', 'Cash to collect')}: <b>{formatMoney(toCollect, locale)}</b></span>
          <span className="text-purple-700">{t('تم تسليمه اليوم', 'Delivered today')}: <b>{deliveredToday.length}</b> · {t('كاش تم تحصيله', 'Cash collected')} <b>{formatMoney(cashCollected, locale)}</b></span>
        </div>
      )}

      {/* Mobile tabs */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto bg-white px-2 py-2 shadow-sm lg:hidden">
        {columns.map((c) => (
          <button key={c.key} className={`btn btn-sm shrink-0 ${tab === c.key ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setTab(c.key)}>
            {t(c.title, c.titleEn)} ({columnOrders(c.statuses).length})
          </button>
        ))}
      </div>

      {!state.ready ? (
        <div className={`grid flex-1 gap-3 p-3 ${deliveryOnly ? 'lg:grid-cols-2' : 'lg:grid-cols-4'}`}>
          {columns.map((c) => <div key={c.key} className="skeleton h-64" />)}
        </div>
      ) : (
        <div className={`grid flex-1 gap-3 p-3 ${deliveryOnly ? 'lg:grid-cols-2' : 'lg:grid-cols-4'}`}>
          {columns.map((c) => {
            const list = columnOrders(c.statuses);
            const unpaid = c.key === 'new' ? list.filter((o) => o.status === 'AWAITING_PAYMENT') : [];
            const shown = c.key === 'new' ? list.filter((o) => o.status !== 'AWAITING_PAYMENT') : list;
            return (
              <section key={c.key} className={`${tab === c.key ? 'flex' : 'hidden'} min-h-0 flex-col rounded-2xl border-t-4 bg-gray-100 ${c.tone} lg:flex`}>
                <h2 className="flex items-center justify-between px-3 py-2 text-lg font-extrabold">
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
                <div className="flex-1 space-y-3 overflow-y-auto px-2 pb-3">
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
                  {shown.length === 0 && unpaid.length === 0 && <p className="py-8 text-center text-sm text-gray-400">{t('لا يوجد', 'No orders')}</p>}
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
              <div key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="font-bold" dir="ltr">#{o.orderNumber}</span>
                <span className="flex-1 truncate">{o.customerName}</span>
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
  state,
  canCreateOrders,
  restaurantId,
  canChangeStatus,
  onStore,
  soundEnabled,
  enableSound,
  paper,
  setPaper,
  onSync,
}: {
  state: EngineState;
  canCreateOrders: boolean;
  restaurantId: string;
  canChangeStatus: boolean;
  onStore: (s: StoreLive) => void;
  soundEnabled: boolean;
  enableSound: () => void;
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
    syncing: { text: t('جاري حفظ التحديثات…', 'Saving updates…'), tone: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500 animate-pulse' },
    offline: { text: t('بدون إنترنت — الطلبات محفوظة', 'Offline — orders are saved'), tone: 'bg-amber-100 text-amber-900', dot: 'bg-amber-500' },
  }[state.connectivity];
  const levelTone = { NORMAL: 'bg-green-600', BUSY: 'bg-amber-500', HEAVY: 'bg-red-600', FULL: 'bg-red-700' };

  async function setStatus(status: 'OPEN' | 'PAUSED' | 'CLOSED') {
    setBusy(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/merchant/store-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restaurantId, status }),
      });
      const data = (await res.json()) as { store?: StoreLive; error?: { message: string } };
      if (res.ok && data.store) onStore(data.store);
      else setStatusError(localizeMessage(data.error?.message ?? t('تعذر التغيير', 'Could not change the status'), locale));
    } catch {
      setStatusError(t('اتصل بالإنترنت لتغيير حالة المطعم.', 'Connect to the internet to change the restaurant status.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-b border-gray-200 bg-white px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {store && <span className={`badge text-sm ${store.status === 'OPEN' ? 'bg-green-100 text-green-800' : store.status === 'BUSY' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>{copy.storeStatus[store.status]}</span>}
          {canChangeStatus && store && store.reason !== 'INACTIVE' && (
            <div className="flex overflow-hidden rounded-xl ring-1 ring-gray-300" role="group" aria-label={t('استقبال الطلبات', 'Order availability')}>
              {(['OPEN', 'PAUSED', 'CLOSED'] as const).map((s) => (
                <button key={s} disabled={busy || state.connectivity === 'offline'} aria-pressed={store.orderingStatus === s} onClick={() => setStatus(s)} className={`min-h-11 px-4 py-2 text-sm font-bold ${store.orderingStatus === s ? 'bg-gray-900 text-white' : 'bg-white hover:bg-gray-50'}`}>
                  {s === 'OPEN' ? t('✓ استقبال', '✓ Accept orders') : s === 'PAUSED' ? t('Ⅱ توقف مؤقت', 'Ⅱ Pause') : t('× إغلاق', '× Close')}
                </button>
              ))}
            </div>
          )}
        </div>
        {canCreateOrders && <a href="/merchant/new-order" className="btn btn-dark btn-sm">➕ {t('طلب جديد من الكاشير', 'New counter order')}</a>}
        {!soundEnabled ? <button className="btn btn-primary btn-sm" onClick={enableSound}>🔔 {t('تفعيل صوت الطلبات', 'Enable order sound')}</button> : <span className="badge bg-green-100 text-green-800">🔔 {t('الصوت مفعّل', 'Sound enabled')}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button className={`badge ${conn.tone} min-h-9 px-3 py-1.5`} onClick={onSync} title={t('تحديث الطلبات الآن', 'Refresh orders now')}>
          <span className={`size-2 rounded-full ${conn.dot}`} />
          {conn.text}
          {state.outboxCount > 0 && <span>· {t(`${state.outboxCount} تحديث ينتظر الإنترنت`, `${state.outboxCount} updates awaiting connection`)}</span>}
        </button>
        {store && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-500">{t('ضغط المطبخ', 'Kitchen workload')}</span>
            <span className={`badge text-white ${levelTone[store.level]}`}>{copy.loadLevel[store.level]}</span>
            <span className="text-gray-500">{t(`حوالي ${store.etaMinutes} دقيقة للطلب الجديد`, `About ${store.etaMinutes} min for a new order`)}</span>
          </div>
        )}
        <details className="ms-auto relative">
          <summary className="cursor-pointer rounded-lg px-3 py-2 text-gray-600">🖨️ {t('إعدادات الطباعة', 'Print settings')}</summary>
          <div className="absolute end-0 top-full z-20 mt-2 w-56 rounded-xl bg-white p-3 shadow-lg ring-1 ring-gray-200">
            <label className="label" htmlFor="receipt-paper">{t('عرض ورق الطابعة', 'Printer paper width')}</label>
            <select id="receipt-paper" className="input" value={paper} onChange={(e) => setPaper(e.target.value as PaperWidth)}>
              <option value="80">{t('80 مم', '80 mm')}</option>
              <option value="58">{t('58 مم', '58 mm')}</option>
            </select>
            {state.lastSyncAt && <p className="mt-2 text-xs text-gray-500">{t('آخر تحديث', 'Last updated')}: {formatTime(state.lastSyncAt, Intl.DateTimeFormat().resolvedOptions().timeZone, locale)}</p>}
          </div>
        </details>
      </div>
      {statusError && <p role="alert" className="text-sm text-red-600">{statusError}</p>}
    </div>
  );
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
  onAction: (o: OrderSnapshot, a: OrderAction) => void;
  onReason: (a: 'CANCEL' | 'REJECT_PAYMENT') => void;
  onPrint: () => void;
  onSeen: () => void;
}) {
  const { locale, t } = useLanguage();
  const copy = labels(locale);
  const pickup = o.fulfillment === 'PICKUP';
  const primary = primaryActionFor(o.status, o.fulfillment);
  const primaryDef = primary ? transitionFor(primary, o.fulfillment) : null;
  const canPrimary = !!primaryDef && perms.has(primaryDef.permission);
  const kitchenPhase = o.status === 'CONFIRMED' || o.status === 'PREPARING';
  const readyIn = o.estimatedReadyAt ? o.estimatedReadyAt - now : null;
  const arriveIn = o.estimatedArrivalAt ? o.estimatedArrivalAt - now : null;
  const primaryTone =
    primary === 'VERIFY_PAYMENT' || primary === 'ACCEPT' ? 'btn-success' : primary === 'MARK_READY' ? 'btn-success' : primary === 'COMPLETE' ? 'btn-dark' : 'btn-primary';

  return (
    <article
      onClick={onSeen}
      className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ${highlighted ? 'ring-4 ring-amber-400' : 'ring-gray-200'} ${o.status === 'AWAITING_PAYMENT' ? 'opacity-75' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-3xl leading-none font-black" dir="ltr">#{o.orderNumber}</div>
          <div className="mt-1 text-xs text-gray-500">{ago(now - o.createdAt, locale)} • {formatTime(o.createdAt, timezone, locale)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {highlighted && <span className="badge bg-amber-400 text-black">{t('جديد!', 'New!')}</span>}
          <span className={`badge ${pickup ? 'bg-orange-100 text-orange-900' : 'bg-sky-100 text-sky-900'}`}>
            {pickup ? t('🏪 استلام من المحل', '🏪 Pickup at counter') : t('🛵 توصيل', '🛵 Delivery')}
            {o.channel === 'COUNTER' ? t(' · كاشير', ' · Counter') : ''}
          </span>
          <span className={`badge ${PAYMENT_STATUS_TONE[o.paymentStatus]}`}>
            {copy.paymentMethod[o.paymentMethod]} • {copy.paymentStatus[o.paymentStatus]}
          </span>
          {pending > 0 && <span className="badge bg-blue-100 text-blue-800">{t('⏳ لم يُزامن بعد', '⏳ Saved on this device')}</span>}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-lg font-bold">{o.customerName}</span>
        {o.customerPhone && (
          <a href={`tel:${o.customerPhone}`} className="text-sm text-blue-700" dir="ltr" onClick={(e) => e.stopPropagation()}>{o.customerPhone}</a>
        )}
      </div>

      <ul className="mt-2 space-y-1 border-y border-dashed border-gray-200 py-2">
        {o.items.map((it) => (
          <li key={it.id}>
            <span className="text-lg font-black">{it.quantity} ×</span> <span className="text-base font-semibold">{localizedName(locale, it.nameAr, it.nameEn)}</span>
            {it.variantNameAr && <span className="text-sm text-gray-600"> ({localizedName(locale, it.variantNameAr, it.variantNameEn)})</span>}
            {it.addons.length > 0 && <div className="ps-6 text-sm text-gray-600">+ {it.addons.map((a) => localizedName(locale, a.nameAr, a.nameEn)).join(locale === 'ar' ? '، ' : ', ')}</div>}
            {it.note && <div className="ps-6 text-sm text-orange-700">* {it.note}</div>}
          </li>
        ))}
      </ul>
      {o.customerNote && <p className="mt-2 rounded-lg bg-yellow-50 p-2 text-sm text-yellow-900">📝 {o.customerNote}</p>}

      <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
        <span className="text-gray-500">{t('الإجمالي', 'Total')}</span>
        <span className="text-end font-bold">{formatMoney(o.total, locale)}</span>
        <span className="text-gray-500">{t('الاستلام', 'Pickup point')}</span>
        <span className="truncate text-end">{localizedName(locale, o.deliveryPointName, o.deliveryPointNameEn)}</span>
        {o.paymentReference && (
          <>
            <span className="text-gray-500">{t('رقم العملية', 'Transfer reference')}</span>
            <span className="text-end font-mono" dir="ltr">{o.paymentReference}</span>
          </>
        )}
        {o.assignedToName && (
          <>
            <span className="text-gray-500">{t('الدليفري', 'Courier')}</span>
            <span className="text-end">{o.assignedToName}</span>
          </>
        )}
      </div>

      {(o.status === 'READY' || o.status === 'OUT_FOR_DELIVERY' || o.status === 'ARRIVED_AT_GATE') &&
        (o.paymentMethod === 'CASH' && o.paymentStatus !== 'PAYMENT_VERIFIED' ? (
          <div className="mt-2 rounded-xl bg-amber-100 px-3 py-2 text-center text-lg font-black text-amber-900">{t(`حصّل ${formatMoney(o.total, locale)} كاش`, `Collect ${formatMoney(o.total, locale)} cash`)}</div>
        ) : (
          <div className="mt-2 rounded-xl bg-green-50 px-3 py-1.5 text-center text-sm font-bold text-green-800">{t('مدفوع ✓ — متحصّلش فلوس', 'Paid ✓ — no cash to collect')}</div>
        ))}
      {o.hasPaymentAttachment && perms.has('payments.verify') && (
        <a href={`/api/merchant/orders/${o.id}/attachment`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-blue-700 underline" onClick={(e) => e.stopPropagation()}>
          📎 {t('صورة التحويل', 'Payment proof')}
        </a>
      )}
      {o.status === 'AWAITING_PAYMENT' && <p className="mt-1 text-xs text-gray-500">{t('العميل لسه ما ضغطش «تم التحويل». لو التحويل وصلك فعلًا تقدر تأكده.', 'Waiting for the customer to confirm the transfer. Verify only when you have received it.')}</p>}

      {kitchenPhase && readyIn !== null && (
        <div className={`mt-2 rounded-xl px-3 py-2 text-center font-mono text-xl font-black ${readyIn >= 0 ? 'bg-orange-50 text-orange-800' : 'bg-red-100 text-red-700'}`} dir="ltr">
          {readyIn >= 0 ? t(`جاهز خلال ${mmss(readyIn)}`, `Ready in ${mmss(readyIn)}`) : t(`متأخر ${mmss(readyIn)}`, `Late by ${mmss(readyIn)}`)}
        </div>
      )}
      {o.status === 'CONFIRMED' && !o.estimatedReadyAt && <div className="mt-2 text-center text-xs text-gray-500">{t('الوقت المتوقع هيتحسب بعد المزامنة', 'The estimated time will appear after syncing')}</div>}
      {(o.status === 'READY' || o.status === 'OUT_FOR_DELIVERY') && arriveIn !== null && (
        <div className="mt-2 text-center text-sm text-gray-600" dir="ltr">{t('وصول متوقع خلال', 'Customer arrival in')}: {arriveIn >= 0 ? mmss(arriveIn) : `+${mmss(arriveIn)}`}</div>
      )}

      {canPrimary && primary && (
        <button
          className={`btn btn-lg mt-3 w-full text-lg ${primaryTone}`}
          onClick={(e) => {
            e.stopPropagation();
            onAction(o, primary);
          }}
        >
          {pickup && primary === 'COMPLETE' ? t('سلّم للعميل ✓', 'Handed to customer ✓') : copy.action[primary]}
          {primary === 'VERIFY_PAYMENT' ? ` (${formatMoney(o.total, locale)})` : ''}
        </button>
      )}
      <details className="mt-2" onClick={(e) => e.stopPropagation()}>
        <summary className="cursor-pointer rounded-lg px-2 py-2 text-sm font-semibold text-gray-600">{t('خيارات أخرى', 'More options')}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
        {o.status === 'PAYMENT_REVIEW' && perms.has('payments.verify') && (
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onReason('REJECT_PAYMENT'); }}>{t('رفض التحويل', 'Reject payment')}</button>
        )}
        {o.status === 'OUT_FOR_DELIVERY' && perms.has('orders.delivery') && (
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onAction(o, 'COMPLETE'); }}>{t('تم التسليم مباشرة', 'Delivered directly')}</button>
        )}
        {perms.has('receipts.print') && (
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onPrint(); }}>{t('🖨️ طباعة', '🖨️ Print')}</button>
        )}
        {perms.has('orders.cancel') && (
          <button className="btn btn-ghost btn-sm text-red-600" onClick={(e) => { e.stopPropagation(); onReason('CANCEL'); }}>{t('إلغاء', 'Cancel')}</button>
        )}
        </div>
      </details>
    </article>
  );
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
