import { formatMoney } from '@/lib/domain/misc';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import type { DayCloseRow } from '@/server/services/stats';
import { PrintPageButton } from './print-page-button';

/** End-of-day close sheet (restaurant: one card; platform: table + totals). */
export async function DayCloseReport({ rows, day, showPlatform }: { rows: DayCloseRow[]; day: string; showPlatform: boolean }) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const m = (v: number) => formatMoney(v, locale);
  const sum = (f: (r: DayCloseRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const checks = [
    sum((r) => r.stillOpen) > 0 && t(`فيه ${sum((r) => r.stillOpen)} طلب من النهارده لسه ما خلصش — خلّصه أو ألغيه قبل الإقفال.`, `${sum((r) => r.stillOpen)} of today’s orders are still open — finish or cancel them before closing.`),
    sum((r) => r.pendingTransfers) > 0 && t(`فيه ${sum((r) => r.pendingTransfers)} تحويل إنستاباي لسه محتاج مراجعة.`, `${sum((r) => r.pendingTransfers)} InstaPay transfers still need checking.`),
    sum((r) => r.courierCashOutstanding) > 0 && t(`المندوبين لسه معاهم ${m(sum((r) => r.courierCashOutstanding))} كاش — استلمها وسجّلها.`, `Couriers still hold ${m(sum((r) => r.courierCashOutstanding))} in cash — collect and record it.`),
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <form className="flex items-end gap-2"><label className="text-xs">{t('اليوم', 'Day')} <input type="date" name="date" defaultValue={day} className="input py-1" /></label><button className="btn btn-secondary btn-sm">{t('عرض', 'Show')}</button></form>
        <PrintPageButton />
      </div>
      {checks.length > 0 ? (
        <ul className="space-y-1 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{checks.map((c) => <li key={c}>⚠️ {c}</li>)}</ul>
      ) : <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">✓ {t('مفيش حاجة معلّقة — اليوم جاهز للإقفال.', 'Nothing pending — the day is ready to close.')}</p>}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr>
            {rows.length > 1 && <th>{t('المطعم', 'Restaurant')}</th>}
            <th>{t('طلبات', 'Orders')}</th><th>{t('اتسلّم', 'Completed')}</th><th>{t('اتلغى', 'Cancelled')}</th><th>{t('ما استلمش', 'No-show')}</th>
            <th>{t('كاش', 'Cash')}</th><th>{t('إنستاباي', 'InstaPay')}</th><th>{t('منها كاشير', 'of which counter')}</th><th>{t('مرتجعات', 'Refunds')}</th><th>{t('مع المندوبين', 'With couriers')}</th>
            {showPlatform && <th>{t('حصة المنصة', 'Platform share')}</th>}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.restaurantId}>
                {rows.length > 1 && <td className="font-semibold">{localizedName(locale, r.nameAr, r.nameEn)}</td>}
                <td>{r.ordersCreated}</td><td>{r.completed}</td><td>{r.cancelled}</td><td>{r.noShows || '—'}</td>
                <td className="font-semibold">{m(r.cashSales)}</td><td className="font-semibold">{m(r.instapaySales)}</td><td>{m(r.counterSales)}</td>
                <td>{r.refunds ? `-${m(r.refunds)}` : '—'}</td><td className={r.courierCashOutstanding > 0 ? 'font-bold text-amber-700' : ''}>{m(r.courierCashOutstanding)}</td>
                {showPlatform && <td className="font-semibold">{m(r.platformShare)}</td>}
              </tr>
            ))}
            {rows.length > 1 && (
              <tr className="font-bold">
                <td>{t('الإجمالي', 'Total')}</td><td>{sum((r) => r.ordersCreated)}</td><td>{sum((r) => r.completed)}</td><td>{sum((r) => r.cancelled)}</td><td>{sum((r) => r.noShows)}</td>
                <td>{m(sum((r) => r.cashSales))}</td><td>{m(sum((r) => r.instapaySales))}</td><td>{m(sum((r) => r.counterSales))}</td><td>{m(sum((r) => r.refunds))}</td><td>{m(sum((r) => r.courierCashOutstanding))}</td>
                {showPlatform && <td>{m(sum((r) => r.platformShare))}</td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">{t('«كاش» و«إنستاباي» = الطلبات اللي اتسلّمت في اليوم ده. قارن الكاش بالدرج، وإنستاباي بكشف الحساب. «مع المندوبين» = الكاش اللي لسه ما اتسلّمش للمطعم (كل الأيام). المرتجعات = اللي اترجع للعملاء في اليوم.', '“Cash” and “InstaPay” are orders completed that day: compare cash with the drawer and InstaPay with the account statement. “With couriers” is cash not yet handed in (all days). Refunds are money returned that day.')}</p>
    </div>
  );
}
