'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPaperWidth } from '@/client/merchant/printing';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import { useLanguage } from '@/components/language-provider';
import { labels, localizedName } from '@/lib/i18n';
import type { OrderSnapshot } from '@/lib/types';

export function Receipt({ order, restaurantName, timezone }: { order: OrderSnapshot; restaurantName: string; timezone: string }) {
  const { locale, t } = useLanguage();
  const copy = labels(locale);
  const paid = ['PAYMENT_VERIFIED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.paymentStatus);
  const refunded = order.refundedTotal ?? 0;
  return (
    <div className="receipt" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
      <h1>{restaurantName}</h1>
      <div className="big" dir="ltr">#{order.orderNumber}</div>
      <div className="muted" style={{ textAlign: 'center' }} dir="ltr">{formatDateTime(order.createdAt, timezone, locale)}</div>
      <hr />
      <div>{t('العميل', 'Customer')}: <b>{order.customerName}</b></div>
      {order.customerPhone && <div dir="ltr" style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>{order.customerPhone}</div>}
      <hr />
      {order.items.map((it) => (
        <div key={it.id} style={{ marginBottom: '1mm' }}>
          <div className="row">
            <span>
              {it.quantity} × {localizedName(locale, it.nameAr, it.nameEn)}
              {it.variantNameAr ? ` (${localizedName(locale, it.variantNameAr, it.variantNameEn)})` : ''}
            </span>
            <span>{formatMoney(it.lineTotal, locale)}</span>
          </div>
          {it.addons.map((a, i) => (
            <div key={i} className="muted">&nbsp;&nbsp;+ {localizedName(locale, a.nameAr, a.nameEn)}</div>
          ))}
          {it.note && <div className="muted">&nbsp;&nbsp;* {it.note}</div>}
        </div>
      ))}
      <hr />
      <div className="row"><span>{t('المجموع', 'Subtotal')}</span><span>{formatMoney(order.subtotal, locale)}</span></div>
      {order.discountTotal > 0 && <div className="row"><span>{t('الخصم', 'Discount')}</span><span>-{formatMoney(order.discountTotal, locale)}</span></div>}
      {order.deliveryFee > 0 && <div className="row"><span>{t('التوصيل', 'Delivery')}</span><span>{formatMoney(order.deliveryFee, locale)}</span></div>}
      <div className="row" style={{ fontWeight: 800, fontSize: '14px' }}><span>{t('الإجمالي', 'Total')}</span><span>{formatMoney(order.total, locale)}</span></div>
      {refunded > 0 && <div className="row"><span>{t('مسترد للعميل', 'Refunded')}</span><span>-{formatMoney(refunded, locale)}</span></div>}
      <hr />
      <div>
        {t('الدفع', 'Payment')}: {copy.paymentMethod[order.paymentMethod]} —{' '}
        <b>{paid ? t('مدفوع ✓', 'PAID ✓') : order.paymentMethod === 'CASH' ? t(`يُحصّل ${formatMoney(order.total, locale)}`, `Collect ${formatMoney(order.total, locale)}`) : t('لم يتم تأكيد الدفع', 'Payment not confirmed')}</b>
      </div>
      <div>{t('الاستلام', 'Pickup point')}: <b>{localizedName(locale, order.deliveryPointName, order.deliveryPointNameEn)}</b></div>
      {order.customerNote && <div>{t('ملاحظة', 'Note')}: {order.customerNote}</div>}
      <hr />
      <div className="muted" style={{ textAlign: 'center' }}>{t('شكرًا لطلبك ♥', 'Thank you for your order ♥')}</div>
    </div>
  );
}

/** Renders the receipt into a print-only root and opens the browser print dialog. */
export function PrintPortal({ order, restaurantName, timezone, onDone }: { order: OrderSnapshot; restaurantName: string; timezone: string; onDone: () => void }) {
  const [mounted, setMounted] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const width = getPaperWidth();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted) return;
    // Print exactly once per mount, even though the parent keeps re-rendering with live data.
    const id = requestAnimationFrame(() => {
      window.print();
      doneRef.current();
    });
    return () => cancelAnimationFrame(id);
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <div id="print-root">
      <style>{`@page { size: ${width}mm auto; margin: 0; } #print-root .receipt { --receipt-width: ${width === '58' ? '48mm' : '72mm'}; margin: 0 auto; }`}</style>
      <Receipt order={order} restaurantName={restaurantName} timezone={timezone} />
    </div>,
    document.body,
  );
}

export function PrintButton({ order, restaurantName, timezone, className = 'btn btn-secondary' }: { order: OrderSnapshot; restaurantName: string; timezone: string; className?: string }) {
  const { t } = useLanguage();
  const [printing, setPrinting] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setPrinting(true)}>🖨️ {t('طباعة الفاتورة', 'Print receipt')}</button>
      {printing && <PrintPortal order={order} restaurantName={restaurantName} timezone={timezone} onDone={() => setPrinting(false)} />}
    </>
  );
}
