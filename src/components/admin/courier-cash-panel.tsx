'use client';

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, Check, RotateCcw, Truck } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { cashAttemptFormData, courierCashAttemptKey, isDefiniteCashRejection, parseCourierCashAttempt, prepareCourierCashAttempt, saveCourierCashAttempt, type CourierCashAttempt, type CourierCashPayload } from '@/client/merchant/courier-cash-attempt';
import { uuid } from '@/client/ids';
import { readJson, removeKey } from '@/client/storage';
import { formatDateTime, formatMoney, parseMoney } from '@/lib/domain/misc';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { localizedName, localizeMessage } from '@/lib/i18n';
import { recordCourierHandInAction, reverseCourierHandInAction } from '@/server/actions/couriers';
import type { merchantCourierOverview } from '@/server/services/couriers';

type CashReport = Awaited<ReturnType<typeof merchantCourierOverview>>;
type CashTarget = { kind: 'HAND_IN'; restaurantId: string; courierUserId: string } | { kind: 'REVERSAL'; handInId: string };
type CashActionState = ActionState & { errorCode?: string };

export function CourierCashPanel({ balances, handIns, actorUserId, timezone, showRestaurant = true }: CashReport & { actorUserId: string; timezone: string; showRestaurant?: boolean }) {
  const { locale, t } = useLanguage();
  const [courierFilter, setCourierFilter] = useState('all');
  const [restaurantFilter, setRestaurantFilter] = useState('all');
  const couriers = [...new Map(balances.map((row) => [row.userId, { id: row.userId, name: row.name }])).values()];
  const restaurants = [...new Map(balances.map((row) => [row.restaurantId, { id: row.restaurantId, nameAr: row.restaurantNameAr, nameEn: row.restaurantNameEn }])).values()];
  const rows = balances.filter((row) => (courierFilter === 'all' || row.userId === courierFilter) && (restaurantFilter === 'all' || row.restaurantId === restaurantFilter));
  const history = handIns.filter((row) => (courierFilter === 'all' || row.courierUserId === courierFilter) && (restaurantFilter === 'all' || row.restaurantId === restaurantFilter));
  const sum = (field: 'cashCollected' | 'handedIn' | 'outstanding') => rows.reduce((total, row) => total + row[field], 0);
  return <div className="space-y-5">
    <section className="card space-y-3"><h2 className="text-lg font-bold">{t('عهدة الكاش مع المندوبين', 'Courier cash to hand in')}</h2><p className="text-sm leading-6 text-gray-600">{t('كل مطعم له حساب منفصل مع كل مندوب. المستحق = الكاش المحصّل من العملاء ناقص المبالغ التي سجلتم استلامها من المندوب، على مدار كل الفترات.', 'Each restaurant has a separate balance with each courier. Outstanding = cash collected from customers minus recorded hand-ins, across all time.')}</p><div className={`grid gap-3 ${showRestaurant ? 'sm:grid-cols-2' : ''}`}><label><span className="label">{t('المندوب', 'Courier')}</span><select className="input" value={courierFilter} onChange={(event) => setCourierFilter(event.target.value)}><option value="all">{t('كل المندوبين', 'All couriers')}</option>{couriers.map((courier) => <option key={courier.id} value={courier.id}>{courier.name}</option>)}</select></label>{showRestaurant && <label><span className="label">{t('المطعم', 'Restaurant')}</span><select className="input" value={restaurantFilter} onChange={(event) => setRestaurantFilter(event.target.value)}><option value="all">{t('كل المطاعم', 'All restaurants')}</option>{restaurants.map((restaurant) => <option key={restaurant.id} value={restaurant.id}>{localizedName(locale, restaurant.nameAr, restaurant.nameEn)}</option>)}</select></label>}</div></section>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[
      [t('الكاش المحصّل', 'Cash collected'), sum('cashCollected')],
      [t('تم استلامه من المندوبين', 'Handed in'), sum('handedIn')],
      [t('المتبقي مع المندوبين', 'Outstanding'), sum('outstanding')],
    ].map(([label, amount]) => <div key={String(label)} className="card"><p className="text-xs text-gray-500">{label}</p><strong className="mt-2 block break-words text-2xl tabular-nums">{formatMoney(Number(amount), locale)}</strong></div>)}</div>
    <section className="grid gap-4 xl:grid-cols-2" aria-label={t('الحساب حسب المندوب والمطعم', 'Balances by courier and restaurant')}>
      {rows.map((row) => <article key={`${row.restaurantId}:${row.userId}`} className="card space-y-4"><header className="flex min-w-0 items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gray-100 text-gray-700"><Truck size={22} /></span><div className="min-w-0"><h3 className="break-words text-lg font-bold" dir="auto">{row.name}</h3>{showRestaurant && <p className="mt-1 break-words text-sm text-gray-500">{localizedName(locale, row.restaurantNameAr, row.restaurantNameEn)}</p>}</div></header><dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><CashValue label={t('سلّم طلبات', 'Delivered orders')} value={String(row.delivered)} /><CashValue label={t('طلبات في الطريق', 'On the way')} value={String(row.onTheWay)} /><CashValue label={t('كاش محصّل', 'Cash collected')} value={formatMoney(row.cashCollected, locale)} /><CashValue label={t('تم تسليمه للمطعم', 'Handed in')} value={formatMoney(row.handedIn, locale)} /><CashValue label={t('كاش متوقع عند التسليم', 'Cash expected on delivery')} value={formatMoney(row.cashPending, locale)} /><CashValue label={t('المتبقي مع المندوب', 'Outstanding')} value={formatMoney(row.outstanding, locale)} prominent /></dl>{row.cashRefunds > 0 && <p className="rounded-lg bg-amber-50 p-2 text-xs leading-5 text-amber-900">{t('مرتجعات نقدية للمراجعة: ', 'Cash refunds to review: ')}{formatMoney(row.cashRefunds, locale)}{t('. راجع من دفعها فعليًا؛ لا تخصم من عهدة المندوب تلقائيًا.', '. Review who actually paid them; they do not automatically reduce the courier balance.')}</p>}<details className="border-t border-gray-100 pt-3"><summary className="cursor-pointer text-sm font-bold text-emerald-800">{t('تسجيل مبلغ استلمته من المندوب', 'Record money received from courier')}</summary><div className="mt-3"><CashEntryForm actorUserId={actorUserId} target={{ kind: 'HAND_IN', restaurantId: row.restaurantId, courierUserId: row.userId }} outstanding={row.outstanding} /></div></details></article>)}
      {!rows.length && <div className="card py-8 text-center text-sm text-gray-500 xl:col-span-2">{t('لا توجد حسابات للمندوبين بهذا الاختيار حتى الآن.', 'No courier balances match this selection yet.')}</div>}
    </section>
    <section className="card space-y-4"><div><h2 className="text-lg font-bold">{t('سجل المبالغ المستلمة والتصحيحات', 'Hand-in and correction history')}</h2><p className="mt-1 text-xs leading-5 text-gray-500">{t('سجل محاسبي لاستلام الكاش فعليًا. تصحيح مبلغ يلغي أثر القيد مع الاحتفاظ به في السجل، ثم يمكنك تسجيل المبلغ الصحيح.', 'An accounting record of cash actually received. Correcting an entry reverses its effect and preserves its history; then record the right amount.')}</p></div><div className="divide-y divide-gray-100">{history.map((entry) => <article key={entry.id} className="space-y-2 py-4 first:pt-0"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-bold" dir="auto">{entry.courierName}</p>{showRestaurant && <p className="mt-1 break-words text-xs text-gray-500">{localizedName(locale, entry.restaurantNameAr, entry.restaurantNameEn)}</p>}</div><div className="text-end"><strong className={`block text-base ${entry.entryKind === 'REVERSAL' ? 'text-amber-800' : 'text-emerald-800'}`}>{entry.entryKind === 'REVERSAL' ? '−' : ''}{formatMoney(entry.amount, locale)}</strong><span className="text-xs text-gray-500">{entry.entryKind === 'REVERSAL' ? t('تصحيح قيد', 'Entry reversal') : entry.reversed ? t('تم إلغاء أثره', 'Reversed') : t('استلام كاش', 'Cash hand-in')}</span></div></div><p className="text-xs leading-5 text-gray-500">{formatDateTime(entry.createdAt, timezone, locale)} · {t('سجّله: ', 'Recorded by: ')}{entry.recordedByName || '—'}</p>{entry.note && <p className="break-words text-sm" dir="auto">{entry.note}</p>}{entry.entryKind === 'HAND_IN' && !entry.reversed && <details className="pt-1"><summary className="cursor-pointer text-xs font-semibold text-amber-800">{t('تصحيح هذا القيد', 'Correct this entry')}</summary><div className="mt-3 max-w-lg"><p className="mb-3 text-xs leading-5 text-gray-600">{t('استخدم التصحيح لو سُجّل مبلغ أو مرجع بالخطأ. سيُضاف قيد عكسي بنفس القيمة؛ سجّل المبلغ الصحيح بعده.', 'Use this if the amount or reference was entered incorrectly. A matching reversal is added; record the correct amount afterwards.')}</p><CashEntryForm actorUserId={actorUserId} target={{ kind: 'REVERSAL', handInId: entry.id }} /></div></details>}</article>)}{!history.length && <p className="py-4 text-center text-sm text-gray-500">{t('لا توجد مبالغ مسجلة بعد.', 'No hand-ins recorded yet.')}</p>}</div></section>
  </div>;
}

function CashValue({ label, value, prominent }: { label: string; value: string; prominent?: boolean }) {
  return <div><dt className="text-xs text-gray-500">{label}</dt><dd className={`mt-1 break-words tabular-nums ${prominent ? 'text-lg font-black text-amber-900' : 'font-semibold'}`}>{value}</dd></div>;
}

function CashEntryForm({ actorUserId, target, outstanding }: { actorUserId: string; target: CashTarget; outstanding?: number }) {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const scope = target.kind === 'HAND_IN' ? `hand-in:${target.restaurantId}:${target.courierUserId}` : `reverse:${target.handInId}`;
  const storageKey = courierCashAttemptKey(actorUserId, scope);
  const form = useRef<HTMLFormElement>(null);
  const attempt = useRef<CourierCashAttempt | null>(null);
  const submitting = useRef(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<CashActionState>(initialActionState);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    const raw = readJson<unknown>(storageKey, null, 'session');
    const saved = parseCourierCashAttempt(raw, actorUserId, scope);
    if (raw && !saved) removeKey(storageKey, 'session');
    attempt.current = saved;
    if (saved) { if (saved.payload.kind === 'HAND_IN') setAmount(saved.payload.amount); setNote(saved.payload.note); }
    if (saved?.pending) form.current?.closest('details')?.setAttribute('open', '');
    setUncertain(!!saved?.pending);
    setRestored(true);
  }, [storageKey, actorUserId, scope]);
  const locked = busy || uncertain || !restored;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !restored) return;
    const replay = attempt.current?.pending ? attempt.current : null;
    const cleanAmount = amount.trim().replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/٫/g, '.');
    const parsedAmount = parseMoney(cleanAmount);
    if (!replay && target.kind === 'HAND_IN' && (!parsedAmount || !/^\d+(?:\.\d{1,2})?$/.test(cleanAmount) || (outstanding !== undefined && parsedAmount > outstanding))) {
      setState({ ok: false, error: t('اكتب مبلغًا أكبر من صفر وفي حدود المتبقي مع المندوب.', 'Enter an amount above zero, up to the courier’s outstanding balance.') });
      return;
    }
    if (!replay && target.kind === 'REVERSAL' && note.trim().length < 3) {
      setState({ ok: false, error: t('اكتب سبب التصحيح من 3 أحرف على الأقل.', 'Enter a correction reason of at least 3 characters.') });
      return;
    }
    const payload: CourierCashPayload = target.kind === 'HAND_IN' ? { ...target, amount: cleanAmount, note: note.trim() } : { ...target, note: note.trim() };
    const next = replay ?? prepareCourierCashAttempt(attempt.current, actorUserId, payload, uuid);
    let saved = false;
    try { saved = saveCourierCashAttempt(next, sessionStorage); } catch { /* Site storage can be blocked. */ }
    if (!saved && !replay) {
      setState({ ok: false, error: t('اسمح للمتصفح بحفظ بيانات الموقع قبل تسجيل المبلغ بأمان.', 'Allow site storage before safely recording this amount.') });
      return;
    }
    submitting.current = true;
    attempt.current = next;
    setUncertain(true);
    setBusy(true);
    setState(initialActionState);
    startTransition(async () => {
      try {
        const action = next.payload.kind === 'HAND_IN' ? recordCourierHandInAction : reverseCourierHandInAction;
        const result: CashActionState = await action(initialActionState, cashAttemptFormData(next));
        setState(result);
        if (result.ok) {
          attempt.current = null;
          removeKey(storageKey, 'session');
          setUncertain(false);
          setAmount('');
          setNote('');
        } else if (!replay && isDefiniteCashRejection(result.errorCode)) {
          attempt.current = { ...next, pending: false };
          try { saveCourierCashAttempt(attempt.current, sessionStorage); } catch { /* Retain the in-memory key. */ }
          setUncertain(false);
        }
      } catch {
        setState({ ok: false, error: t('النتيجة غير مؤكدة. اضغط تأكيد نفس القيد لمراجعته دون تسجيله مرتين.', 'The result is uncertain. Confirm the same entry to check without recording it twice.') });
      } finally {
        submitting.current = false;
        setBusy(false);
        router.refresh();
      }
    });
  }

  return <form ref={form} className="space-y-3" onSubmit={submit}>
    <fieldset disabled={locked} className="min-w-0 space-y-3">{target.kind === 'HAND_IN' && <label className="block"><span className="label">{t('المبلغ الذي استلمته بالجنيه', 'Amount received in EGP')}</span><input className="input" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" dir="ltr" maxLength={40} placeholder="0.00" required /><span className="mt-1 block text-xs text-gray-500">{t('المتبقي حاليًا: ', 'Currently outstanding: ')}{formatMoney(outstanding ?? 0, locale)}</span></label>}<label className="block"><span className="label">{target.kind === 'REVERSAL' ? t('سبب التصحيح', 'Reason for correction') : t('مرجع أو ملاحظة · اختياري', 'Reference or note · optional')}</span><input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} required={target.kind === 'REVERSAL'} /></label></fieldset>
    {uncertain && <p className="rounded-lg bg-amber-50 p-2 text-xs leading-5 text-amber-900" role="status">{t('القيد محفوظ حتى نتأكد من نتيجته. أكّد نفس القيد قبل تغيير المبلغ أو المرجع.', 'This entry is saved until its result is confirmed. Confirm the same entry before changing its amount or reference.')}</p>}
    {state.error && <p className="text-sm font-semibold text-red-700" role="alert">{localizeMessage(state.error, locale)}</p>}
    {state.ok && <p className="text-sm font-semibold text-emerald-800" role="status">{state.message ? localizeMessage(state.message, locale) : t('تم التسجيل', 'Recorded')}</p>}
    <button type="submit" className={`btn min-h-12 w-full ${target.kind === 'REVERSAL' ? 'btn-secondary text-amber-900' : 'btn-primary'}`} disabled={busy || !restored || (!uncertain && target.kind === 'HAND_IN' && (outstanding ?? 0) <= 0)}>{busy ? <>{t('جاري التأكيد…', 'Confirming…')}</> : uncertain ? <><Check size={18} />{t('تأكيد نفس القيد', 'Confirm same entry')}</> : target.kind === 'REVERSAL' ? <><RotateCcw size={17} />{t('إلغاء أثر هذا القيد', 'Reverse this entry')}</> : <><Banknote size={18} />{t('تسجيل استلام المبلغ', 'Record received cash')}</>}</button>
  </form>;
}
