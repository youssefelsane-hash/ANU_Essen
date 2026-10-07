'use client';

import { RotateCcw } from 'lucide-react';
import { ActionForm, SubmitButton } from './forms';
import { useLanguage } from './language-provider';
import { recordRefundAction, rejectRefundAction } from '@/server/actions/refunds';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import type { OrderSnapshot, RefundView } from '@/lib/types';

const RECEIVED = new Set(['PAYMENT_VERIFIED', 'PARTIALLY_REFUNDED']);
/** Mirrors refundableAmount() on the server. */
const received = (o: OrderSnapshot) => RECEIVED.has(o.paymentStatus) || (o.paymentStatus === 'PAYMENT_SUBMITTED' && o.status === 'CANCELLED');

/** Refund requests + history for one order, and the staff form to give money back. */
export function RefundPanel({ order: o, timezone, canRefund }: { order: OrderSnapshot; timezone: string; canRefund: boolean }) {
  const { t, locale } = useLanguage();
  const refunds = o.refunds ?? [];
  const refunded = o.refundedTotal ?? 0;
  const remaining = received(o) ? Math.max(0, o.total - refunded) : 0;
  const open = refunds.find((r) => r.status === 'REQUESTED');
  const money = (n: number) => formatMoney(n, locale);
  if (!refunds.length && !(canRefund && remaining > 0)) return null;

  return (
    <section className="card space-y-3" aria-labelledby="refunds-title">
      <h2 id="refunds-title" className="flex items-center gap-2 font-bold"><RotateCcw size={18} />{t('الاسترداد', 'Refunds')}</h2>
      {o.paymentStatus === 'PAYMENT_SUBMITTED' && o.status === 'CANCELLED' && remaining > 0 && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{t('العميل بعت تحويل والطلب اتلغى. راجع حساب إنستاباي، ولو الفلوس وصلت رجّعها وسجّلها هنا.', 'The customer sent a transfer and the order was cancelled. Check InstaPay; if the money arrived, send it back and record it here.')}</p>
      )}
      {refunded > 0 && <p className="text-sm">{t('اترجع للعميل', 'Refunded to customer')}: <b>{money(refunded)}</b> {t('من', 'of')} {money(o.total)}</p>}

      {open && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-bold text-amber-900">{t('العميل طالب استرجاع فلوسه', 'The customer asked for a refund')} — {formatDateTime(open.createdAt, timezone, locale)}</p>
          {open.reason && <p>{t('السبب', 'Reason')}: {open.reason}</p>}
          {open.payoutDetails && <p>{t('يرجع الفلوس على', 'Send the money to')}: <b dir="auto">{open.payoutDetails}</b></p>}
          {canRefund ? (
            <div className="space-y-4">
              <RefundForm orderId={o.id} remaining={remaining} defaultMethod={o.paymentMethod} submitLabel={t('موافقة واسترداد', 'Approve & refund')} />
              <ActionForm action={rejectRefundAction} className="space-y-2 border-t border-amber-200 pt-3">
                <input type="hidden" name="refundId" value={open.id} />
                <input type="hidden" name="orderId" value={o.id} />
                <label className="block">
                  <span className="label">{t('سبب الرفض (العميل هيشوفه)', 'Reason for declining (the customer sees it)')}</span>
                  <input name="note" className="input" required minLength={2} maxLength={300} />
                </label>
                <SubmitButton className="btn btn-secondary w-full">{t('رفض الطلب', 'Decline request')}</SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <p className="text-amber-900">{t('صاحب أو مدير المطعم بيراجع الطلب.', 'The restaurant owner or manager will review it.')}</p>
          )}
        </div>
      )}

      {!open && canRefund && remaining > 0 && (
        <details className="rounded-xl border border-gray-200 p-3">
          <summary className="cursor-pointer font-semibold">{t('استرداد مبلغ للعميل', 'Refund the customer')}</summary>
          <div className="mt-3"><RefundForm orderId={o.id} remaining={remaining} defaultMethod={o.paymentMethod} submitLabel={t('تسجيل الاسترداد', 'Record refund')} /></div>
        </details>
      )}

      {refunds.filter((r) => r.status !== 'REQUESTED').length > 0 && (
        <ul className="space-y-2 text-sm">
          {refunds.filter((r) => r.status !== 'REQUESTED').map((r) => <RefundRow key={r.id} refund={r} timezone={timezone} />)}
        </ul>
      )}
    </section>
  );
}

function RefundRow({ refund: r, timezone }: { refund: RefundView; timezone: string }) {
  const { t, locale } = useLanguage();
  const done = r.status === 'COMPLETED';
  return (
    <li className={`rounded-lg p-2 ${done ? 'bg-green-50 text-green-900' : 'bg-gray-100 text-gray-700'}`}>
      <div className="flex flex-wrap justify-between gap-2 font-semibold">
        <span>{done ? `${t('تم استرداد', 'Refunded')} ${formatMoney(r.amount, locale)}` : t('طلب استرجاع مرفوض', 'Refund request declined')}{done && r.method ? ` • ${r.method === 'INSTAPAY' ? t('إنستاباي', 'InstaPay') : t('كاش', 'Cash')}` : ''}</span>
        <span className="text-xs font-normal">{formatDateTime(r.decidedAt ?? r.createdAt, timezone, locale)}</span>
      </div>
      {r.reason && <p className="text-xs">{t('السبب', 'Reason')}: {r.reason}</p>}
      {r.decisionNote && r.decisionNote !== r.reason && <p className="text-xs">{t('ملاحظة المطعم', 'Restaurant note')}: {r.decisionNote}</p>}
      {r.reference && <p className="text-xs">{t('رقم العملية', 'Reference')}: <span dir="ltr">{r.reference}</span></p>}
    </li>
  );
}

function RefundForm({ orderId, remaining, defaultMethod, submitLabel }: { orderId: string; remaining: number; defaultMethod: 'CASH' | 'INSTAPAY'; submitLabel: string }) {
  const { t, locale } = useLanguage();
  const max = (remaining / 100).toFixed(2);
  return (
    <ActionForm action={recordRefundAction} className="space-y-2" confirm={t('متأكد إن الفلوس اترجعت للعميل؟ الخطوة دي بتتسجل ومش بتتلغي.', 'Confirm the money was given back? This is recorded and cannot be undone.')}>
      <input type="hidden" name="orderId" value={orderId} />
      <label className="block">
        <span className="label">{t('المبلغ (سيبه فاضي = المبلغ كله)', 'Amount (leave empty = everything)')}</span>
        <input name="amount" className="input" inputMode="decimal" type="number" min="0.01" step="0.01" max={max} placeholder={formatMoney(remaining, locale)} />
      </label>
      <label className="block">
        <span className="label">{t('رجعت الفلوس إزاي؟', 'How was it given back?')}</span>
        <select name="method" className="input" defaultValue={defaultMethod}>
          <option value="INSTAPAY">{t('تحويل إنستاباي', 'InstaPay transfer')}</option>
          <option value="CASH">{t('كاش', 'Cash')}</option>
        </select>
      </label>
      <label className="block">
        <span className="label">{t('السبب', 'Reason')}</span>
        <input name="reason" className="input" maxLength={300} placeholder={t('مثلاً: صنف ناقص', 'e.g. missing item')} />
      </label>
      <label className="block">
        <span className="label">{t('رقم عملية التحويل (اختياري)', 'Transfer reference (optional)')}</span>
        <input name="reference" className="input" maxLength={100} dir="ltr" />
      </label>
      <SubmitButton className="btn btn-primary w-full">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
