'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, ShoppingBag } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { MY_ORDERS_KEY, readJson, type SavedOrder } from '@/client/storage';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import { labels, localizedName } from '@/lib/i18n';
import type { TrackingView } from '@/lib/types';

type Row = SavedOrder & { view?: TrackingView | null };

/** Orders placed from this phone (kept on the device only), with their live status. */
export function MyOrders() {
  const { locale, t } = useLanguage();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const saved = readJson<SavedOrder[]>(MY_ORDERS_KEY, []);
    const list = Array.isArray(saved) ? saved.filter((o) => o && typeof o.token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(o.token)) : [];
    setRows(list);
    let cancelled = false;
    Promise.all(list.map(async (o) => {
      try {
        const res = await fetch(`/api/public/orders/${o.token}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        return { ...o, view: res.ok ? ((await res.json()) as TrackingView) : null };
      } catch {
        return { ...o, view: undefined };
      }
    })).then((withViews) => { if (!cancelled) setRows(withViews); });
    return () => { cancelled = true; };
  }, []);

  if (rows === null) return <p className="py-10 text-center text-stone-500">{t('جاري التحميل…', 'Loading…')}</p>;
  if (!rows.length) {
    return (
      <div className="card py-14 text-center">
        <ShoppingBag className="mx-auto mb-4 text-stone-400" />
        <p>{t('لسه ما طلبتش من الموبايل ده.', 'No orders from this phone yet.')}</p>
        <Link href="/" className="btn btn-primary mt-5">{t('اختار مطعم', 'Choose a restaurant')}</Link>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {rows.map((o) => {
        const v = o.view;
        const name = v ? localizedName(locale, v.restaurant.nameAr, v.restaurant.nameEn) : o.slug;
        return (
          <li key={o.token}>
            <Link href={`/order/${o.token}`} className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-white p-4 transition hover:border-stone-400">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-stone-100"><ShoppingBag size={19} /></span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate">{name}</strong>
                <small className="block text-stone-500">
                  <span dir="ltr" className="font-semibold text-stone-700">#{o.orderNumber}</span>{' · '}
                  {formatDateTime(o.createdAt, v?.restaurant.timezone ?? 'Africa/Cairo', locale)}
                  {v ? ` · ${labels(locale).status[v.order.status]}` : v === null ? ` · ${t('الطلب مش متاح', 'Unavailable')}` : ''}
                  {v && v.order.refundedTotal > 0 ? ` · ${t('مسترد', 'Refunded')} ${formatMoney(v.order.refundedTotal, locale)}` : ''}
                </small>
              </span>
              {(v?.order.total ?? o.total) !== undefined && <b className="shrink-0">{formatMoney(v?.order.total ?? o.total ?? 0, locale)}</b>}
              <ArrowLeft size={17} className="directional-arrow shrink-0 text-stone-400" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
