'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MerchantEngine, type EngineState } from '@/client/merchant/engine';
import { getPaperWidth, setPaperWidth, type PaperWidth } from '@/client/merchant/printing';
import { formatMoney, formatTime } from '@/lib/domain/misc';
import { isTerminal, primaryActionFor, TRANSITIONS, type OrderAction, type OrderStatus } from '@/lib/domain/order-machine';
import { ACTION_AR, LOAD_LEVEL_AR, PAYMENT_STATUS_AR, PAYMENT_STATUS_TONE, STATUS_AR, STORE_STATUS_AR } from '@/lib/labels';
import type { OrderSnapshot, StoreLive } from '@/lib/types';
import { PrintPortal } from './receipt';

interface Props {
  userId: string;
  restaurant: { id: string; nameAr: string; timezone: string };
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

const COLUMNS: { key: string; title: string; statuses: OrderStatus[]; tone: string }[] = [
  { key: 'new', title: 'جديد', statuses: ['CREATED', 'PAYMENT_REVIEW', 'CONFIRMED', 'AWAITING_PAYMENT'], tone: 'border-t-amber-500' },
  { key: 'preparing', title: 'بيتحضر', statuses: ['PREPARING'], tone: 'border-t-orange-500' },
  { key: 'ready', title: 'جاهز', statuses: ['READY'], tone: 'border-t-green-600' },
  { key: 'delivery', title: 'توصيل', statuses: ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE'], tone: 'border-t-purple-600' },
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

function ago(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 1 ? 'دلوقتي' : `منذ ${m} د`;
}
function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(Math.abs(ms) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function KitchenBoard({ restaurant, permissions, userId }: Props) {
  const perms = useMemo(() => new Set(permissions), [permissions]);
  const [engine, setEngine] = useState<MerchantEngine | null>(null);
  const chime = useChime();
  const alertRef = useRef<(orders: OrderSnapshot[]) => void>(() => {});
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState('new');
  const [showUnpaid, setShowUnpaid] = useState(false);
  const [reasonFor, setReasonFor] = useState<{ order: OrderSnapshot; action: 'CANCEL' | 'REJECT_PAYMENT' } | null>(null);
  const [printing, setPrinting] = useState<OrderSnapshot | null>(null);
  const [paper, setPaper] = useState<PaperWidth>('80');
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    const e = new MerchantEngine(restaurant.id, userId, perms, (o) => alertRef.current(o));
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
        for (const o of orders.slice(0, 3)) new Notification(`طلب #${o.orderNumber} — ${STATUS_AR[o.status]}`, { body: `${o.customerName} • ${formatMoney(o.total)}`, tag: o.id });
      }
    } catch {
      /* ignore */
    }
  };

  const state = useSyncExternalStore(engine?.subscribe ?? noopSubscribe, engine?.getState ?? getEmpty, getEmpty);
  const serverNow = now + state.serverOffset;
  const highlightedCount = Object.keys(state.highlighted).length;

  useEffect(() => {
    document.title = highlightedCount ? `(${highlightedCount}) طلب جديد — ${restaurant.nameAr}` : `الطلبات — ${restaurant.nameAr}`;
  }, [highlightedCount, restaurant.nameAr]);

  const act = useCallback(
    async (order: OrderSnapshot, action: OrderAction, reason?: string) => {
      engine?.unhighlight(order.id);
      await engine?.dispatch(order.id, action, reason ? { reason } : undefined);
    },
    [engine],
  );

  const active = state.orders.filter((o) => !isTerminal(o.status));
  const recentDone = state.orders
    .filter((o) => isTerminal(o.status))
    .sort((a, b) => (b.completedAt ?? b.cancelledAt ?? 0) - (a.completedAt ?? a.cancelledAt ?? 0))
    .slice(0, 8);

  const columnOrders = (statuses: OrderStatus[]) =>
    active
      .filter((o) => statuses.includes(o.status))
      .sort((a, b) => (NEW_PRIORITY[a.status] ?? 0) - (NEW_PRIORITY[b.status] ?? 0) || a.createdAt - b.createdAt);

  if (startError) {
    return <div className="m-4 rounded-2xl bg-red-50 p-4 text-red-800">تعذر فتح التخزين المحلي على الجهاز: {startError}</div>;
  }

  return (
    <div className="flex min-h-[calc(100dvh-52px)] flex-col">
      <TopBar
        state={state}
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
          انتهت الجلسة — الطلبات محفوظة على الجهاز. <a className="underline" href="/login?next=/merchant">سجّل دخول تاني</a>
        </div>
      )}
      {state.notice && (
        <div className="flex items-center justify-between bg-amber-100 px-4 py-2 text-sm text-amber-900">
          <span>{state.notice}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => engine?.clearNotice()}>✕</button>
        </div>
      )}
      {state.store?.status === 'PAUSED' && state.store.reason === 'CAPACITY' && (
        <div className="bg-red-100 px-4 py-2 text-center text-sm font-semibold text-red-800">المطبخ وصل للحد الأقصى — الطلبات الجديدة متوقفة تلقائيًا لحد ما الضغط يخف</div>
      )}

      {/* Mobile tabs */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto bg-white px-2 py-2 shadow-sm lg:hidden">
        {COLUMNS.map((c) => (
          <button key={c.key} className={`btn btn-sm shrink-0 ${tab === c.key ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setTab(c.key)}>
            {c.title} ({columnOrders(c.statuses).length})
          </button>
        ))}
      </div>

      {!state.ready ? (
        <div className="grid flex-1 gap-3 p-3 lg:grid-cols-4">
          {COLUMNS.map((c) => <div key={c.key} className="skeleton h-64" />)}
        </div>
      ) : (
        <div className="grid flex-1 gap-3 p-3 lg:grid-cols-4">
          {COLUMNS.map((c) => {
            const list = columnOrders(c.statuses);
            const unpaid = c.key === 'new' ? list.filter((o) => o.status === 'AWAITING_PAYMENT') : [];
            const shown = c.key === 'new' ? list.filter((o) => o.status !== 'AWAITING_PAYMENT') : list;
            return (
              <section key={c.key} className={`${tab === c.key ? 'flex' : 'hidden'} min-h-0 flex-col rounded-2xl border-t-4 bg-gray-100 ${c.tone} lg:flex`}>
                <h2 className="flex items-center justify-between px-3 py-2 text-lg font-extrabold">
                  {c.title}
                  <span className="badge bg-white text-gray-800">{shown.length}</span>
                </h2>
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
                  {shown.length === 0 && unpaid.length === 0 && <p className="py-8 text-center text-sm text-gray-400">لا يوجد</p>}
                  {unpaid.length > 0 && (
                    <div className="rounded-xl bg-white/60 p-2">
                      <button className="btn btn-ghost btn-sm w-full justify-between" onClick={() => setShowUnpaid((v) => !v)}>
                        <span>بانتظار تحويل العميل ({unpaid.length})</span>
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
          <summary className="cursor-pointer text-sm font-bold">آخر الطلبات المنتهية ({recentDone.length})</summary>
          <div className="mt-2 divide-y divide-gray-100">
            {recentDone.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="font-bold" dir="ltr">#{o.orderNumber}</span>
                <span className="flex-1 truncate">{o.customerName}</span>
                <span className={`badge ${o.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>{STATUS_AR[o.status]}</span>
                <span>{formatMoney(o.total)}</span>
                {perms.has('receipts.print') && <button className="btn btn-secondary btn-sm" onClick={() => setPrinting(o)}>🖨️ إعادة طباعة</button>}
              </div>
            ))}
          </div>
        </details>
      )}

      {reasonFor && (
        <ReasonDialog
          title={reasonFor.action === 'CANCEL' ? `إلغاء الطلب #${reasonFor.order.orderNumber}` : `رفض تحويل #${reasonFor.order.orderNumber}`}
          placeholder={reasonFor.action === 'CANCEL' ? 'سبب الإلغاء' : 'مثلاً: ملقيناش التحويل — راجع الرقم'}
          confirmLabel={reasonFor.action === 'CANCEL' ? 'إلغاء الطلب' : 'رفض التحويل'}
          onCancel={() => setReasonFor(null)}
          onConfirm={async (reason) => {
            await act(reasonFor.order, reasonFor.action, reason);
            setReasonFor(null);
          }}
        />
      )}
      {printing && <PrintPortal order={printing} restaurantName={restaurant.nameAr} timezone={restaurant.timezone} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function TopBar({
  state,
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
  restaurantId: string;
  canChangeStatus: boolean;
  onStore: (s: StoreLive) => void;
  soundEnabled: boolean;
  enableSound: () => void;
  paper: PaperWidth;
  setPaper: (w: PaperWidth) => void;
  onSync: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const store = state.store;
  const conn = {
    online: { text: 'متصل', tone: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
    synced: { text: 'تمت المزامنة ✓', tone: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
    syncing: { text: 'جاري المزامنة…', tone: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500 animate-pulse' },
    offline: { text: 'أوفلاين — شغالين محليًا', tone: 'bg-amber-100 text-amber-900', dot: 'bg-amber-500' },
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
      else setStatusError(data.error?.message ?? 'تعذر التغيير');
    } catch {
      setStatusError('محتاج نت عشان تغيّر حالة المحل');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
      <button className={`badge ${conn.tone} px-3 py-1.5 text-sm`} onClick={onSync} title="مزامنة الآن">
        <span className={`size-2 rounded-full ${conn.dot}`} />
        {conn.text}
        {state.outboxCount > 0 && <span>({state.outboxCount} في الانتظار)</span>}
      </button>
      {state.lastSyncAt && <span className="hidden text-xs text-gray-400 sm:inline">آخر مزامنة {new Date(state.lastSyncAt).toLocaleTimeString('en-GB')}</span>}

      {store && (
        <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-1.5 ring-1 ring-gray-200" title="Kitchen load (load units)">
          <span className="text-xs text-gray-500">ضغط المطبخ</span>
          <span className="font-mono text-lg font-black" dir="ltr">
            {store.load}
            {store.tierMax !== null ? ` / ${store.tierMax}` : ''}
          </span>
          <span className={`badge text-white ${levelTone[store.level]}`}>{LOAD_LEVEL_AR[store.level]}</span>
          <span className="text-xs text-gray-500">~{store.etaMinutes} د للطلب الجديد</span>
        </div>
      )}

      <div className="ms-auto flex flex-wrap items-center gap-2">
        {store && (
          <span className={`badge ${store.status === 'OPEN' ? 'bg-green-100 text-green-800' : store.status === 'BUSY' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>
            المحل: {STORE_STATUS_AR[store.status]}
          </span>
        )}
        {canChangeStatus && store && (
          <div className="flex overflow-hidden rounded-xl ring-1 ring-gray-300">
            {(['OPEN', 'PAUSED', 'CLOSED'] as const).map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => setStatus(s)}
                className={`px-3 py-1.5 text-xs font-semibold ${store.orderingStatus === s ? 'bg-gray-900 text-white' : 'bg-white hover:bg-gray-50'}`}
              >
                {s === 'OPEN' ? 'استقبال' : s === 'PAUSED' ? 'إيقاف مؤقت' : 'قفل'}
              </button>
            ))}
          </div>
        )}
        <select className="rounded-lg border border-gray-300 px-2 py-1 text-xs" value={paper} onChange={(e) => setPaper(e.target.value as PaperWidth)} aria-label="عرض ورق الطابعة">
          <option value="80">ورق 80mm</option>
          <option value="58">ورق 58mm</option>
        </select>
        {!soundEnabled ? (
          <button className="btn btn-primary btn-sm animate-pulse" onClick={enableSound}>🔔 فعّل صوت الطلبات</button>
        ) : (
          <span className="badge bg-green-100 text-green-800">🔔 الصوت شغال</span>
        )}
      </div>
      {statusError && <p className="w-full text-xs text-red-600">{statusError}</p>}
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
  const primary = primaryActionFor(o.status);
  const canPrimary = !!primary && perms.has(TRANSITIONS[primary].permission);
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
          <div className="mt-1 text-xs text-gray-500">{ago(now - o.createdAt)} • {formatTime(o.createdAt, timezone)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {highlighted && <span className="badge bg-amber-400 text-black">جديد!</span>}
          <span className={`badge ${PAYMENT_STATUS_TONE[o.paymentStatus]}`}>
            {o.paymentMethod === 'INSTAPAY' ? 'InstaPay' : 'كاش'} • {PAYMENT_STATUS_AR[o.paymentStatus]}
          </span>
          {pending > 0 && <span className="badge bg-blue-100 text-blue-800">⏳ لم يُزامن بعد</span>}
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
            <span className="text-lg font-black">{it.quantity} ×</span> <span className="text-base font-semibold">{it.nameAr}</span>
            {it.variantNameAr && <span className="text-sm text-gray-600"> ({it.variantNameAr})</span>}
            {it.addons.length > 0 && <div className="ps-6 text-sm text-gray-600">+ {it.addons.map((a) => a.nameAr).join('، ')}</div>}
            {it.note && <div className="ps-6 text-sm text-orange-700">* {it.note}</div>}
          </li>
        ))}
      </ul>
      {o.customerNote && <p className="mt-2 rounded-lg bg-yellow-50 p-2 text-sm text-yellow-900">📝 {o.customerNote}</p>}

      <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
        <span className="text-gray-500">الإجمالي</span>
        <span className="text-end font-bold">{formatMoney(o.total)}</span>
        <span className="text-gray-500">الاستلام</span>
        <span className="truncate text-end">{o.deliveryPointName}</span>
        {o.paymentReference && (
          <>
            <span className="text-gray-500">رقم العملية</span>
            <span className="text-end font-mono" dir="ltr">{o.paymentReference}</span>
          </>
        )}
        {o.assignedToName && (
          <>
            <span className="text-gray-500">الدليفري</span>
            <span className="text-end">{o.assignedToName}</span>
          </>
        )}
      </div>

      {o.hasPaymentAttachment && perms.has('payments.verify') && (
        <a href={`/api/merchant/orders/${o.id}/attachment`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-blue-700 underline" onClick={(e) => e.stopPropagation()}>
          📎 صورة التحويل
        </a>
      )}
      {o.status === 'AWAITING_PAYMENT' && <p className="mt-1 text-xs text-gray-500">العميل لسه ما ضغطش «تم التحويل». لو التحويل وصلك فعلًا تقدر تأكده.</p>}

      {kitchenPhase && readyIn !== null && (
        <div className={`mt-2 rounded-xl px-3 py-2 text-center font-mono text-xl font-black ${readyIn >= 0 ? 'bg-orange-50 text-orange-800' : 'bg-red-100 text-red-700'}`} dir="ltr">
          {readyIn >= 0 ? `جاهز خلال ${mmss(readyIn)}` : `متأخر ${mmss(readyIn)}`}
        </div>
      )}
      {o.status === 'CONFIRMED' && !o.estimatedReadyAt && <div className="mt-2 text-center text-xs text-gray-500">الوقت المتوقع هيتحسب بعد المزامنة</div>}
      {(o.status === 'READY' || o.status === 'OUT_FOR_DELIVERY') && arriveIn !== null && (
        <div className="mt-2 text-center text-sm text-gray-600" dir="ltr">ETA للعميل: {arriveIn >= 0 ? mmss(arriveIn) : `+${mmss(arriveIn)}`}</div>
      )}

      {canPrimary && primary && (
        <button
          className={`btn btn-lg mt-3 w-full text-lg ${primaryTone}`}
          onClick={(e) => {
            e.stopPropagation();
            onAction(o, primary);
          }}
        >
          {ACTION_AR[primary]}
          {primary === 'VERIFY_PAYMENT' ? ` (${formatMoney(o.total)})` : ''}
        </button>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {o.status === 'PAYMENT_REVIEW' && perms.has('payments.verify') && (
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onReason('REJECT_PAYMENT'); }}>رفض التحويل</button>
        )}
        {o.status === 'OUT_FOR_DELIVERY' && perms.has('orders.delivery') && (
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onAction(o, 'COMPLETE'); }}>تم التسليم مباشرة</button>
        )}
        {perms.has('receipts.print') && (
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onPrint(); }}>🖨️ طباعة</button>
        )}
        {perms.has('orders.cancel') && (
          <button className="btn btn-ghost btn-sm text-red-600" onClick={(e) => { e.stopPropagation(); onReason('CANCEL'); }}>إلغاء</button>
        )}
      </div>
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
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4">
        <h3 className="mb-3 text-lg font-bold">{title}</h3>
        <textarea className="input min-h-24" placeholder={placeholder} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onCancel}>رجوع</button>
          <button className="btn btn-danger" onClick={() => onConfirm(reason.trim())}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
