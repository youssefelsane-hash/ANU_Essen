'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPaperWidth } from '@/client/merchant/printing';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import { PAYMENT_METHOD_AR } from '@/lib/labels';
import type { OrderSnapshot } from '@/lib/types';

export function Receipt({ order, restaurantName, timezone }: { order: OrderSnapshot; restaurantName: string; timezone: string }) {
  const paid = order.paymentStatus === 'PAYMENT_VERIFIED';
  return (
    <div className="receipt">
      <h1>{restaurantName}</h1>
      <div className="big" dir="ltr">#{order.orderNumber}</div>
      <div className="muted" style={{ textAlign: 'center' }} dir="ltr">{formatDateTime(order.createdAt, timezone)}</div>
      <hr />
      <div>العميل: <b>{order.customerName}</b></div>
      {order.customerPhone && <div dir="ltr" style={{ textAlign: 'right' }}>{order.customerPhone}</div>}
      <hr />
      {order.items.map((it) => (
        <div key={it.id} style={{ marginBottom: '1mm' }}>
          <div className="row">
            <span>
              {it.quantity} × {it.nameAr}
              {it.variantNameAr ? ` (${it.variantNameAr})` : ''}
            </span>
            <span>{formatMoney(it.lineTotal)}</span>
          </div>
          {it.addons.map((a, i) => (
            <div key={i} className="muted">&nbsp;&nbsp;+ {a.nameAr}</div>
          ))}
          {it.note && <div className="muted">&nbsp;&nbsp;* {it.note}</div>}
        </div>
      ))}
      <hr />
      <div className="row"><span>المجموع</span><span>{formatMoney(order.subtotal)}</span></div>
      {order.discountTotal > 0 && <div className="row"><span>الخصم</span><span>-{formatMoney(order.discountTotal)}</span></div>}
      {order.deliveryFee > 0 && <div className="row"><span>التوصيل</span><span>{formatMoney(order.deliveryFee)}</span></div>}
      <div className="row" style={{ fontWeight: 800, fontSize: '14px' }}><span>الإجمالي</span><span>{formatMoney(order.total)}</span></div>
      <hr />
      <div>
        الدفع: {PAYMENT_METHOD_AR[order.paymentMethod]} —{' '}
        <b>{paid ? 'مدفوع PAID' : order.paymentMethod === 'CASH' ? `يُحصّل ${formatMoney(order.total)}` : 'لم يتم التأكيد'}</b>
      </div>
      <div>الاستلام: <b>{order.deliveryPointName}</b></div>
      {order.customerNote && <div>ملاحظة: {order.customerNote}</div>}
      <hr />
      <div className="muted" style={{ textAlign: 'center' }}>شكرًا لطلبك ♥</div>
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
  const [printing, setPrinting] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setPrinting(true)}>🖨️ طباعة الفاتورة</button>
      {printing && <PrintPortal order={order} restaurantName={restaurantName} timezone={timezone} onDone={() => setPrinting(false)} />}
    </>
  );
}
