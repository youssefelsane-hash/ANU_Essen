import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { restaurants, settlements, users } from '@/server/db/schema';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { financeByRestaurant, salesBySource } from '@/server/services/stats';
import { recordSettlementAction } from '@/server/actions/admin-platform';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle, Stat } from '@/components/admin/ui';
import { localDateString, localDateToUtc } from '@/lib/domain/hours';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';

export const dynamic = 'force-dynamic';

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/finance', 'platform.finance'))) return <Forbidden />;
  const tz = await platformTimezone();
  const sp = await searchParams;
  const today = localDateString(new Date(), tz);
  const fromStr = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const toStr = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const from = localDateToUtc(fromStr, tz);
  const to = new Date(localDateToUtc(toStr, tz).getTime() + 24 * 3600_000);

  const [rows, sources, history, restaurantList] = await Promise.all([
    financeByRestaurant(db(), from, to),
    salesBySource(db(), from, to),
    db()
      .select({ s: settlements, restaurant: locale === 'ar' ? restaurants.nameAr : restaurants.nameEn, by: users.name })
      .from(settlements)
      .innerJoin(restaurants, eq(restaurants.id, settlements.restaurantId))
      .leftJoin(users, eq(users.id, settlements.recordedByUserId))
      .orderBy(desc(settlements.paidAt))
      .limit(50),
    db().select({ id: restaurants.id, nameEn: locale === 'ar' ? restaurants.nameAr : restaurants.nameEn }).from(restaurants).orderBy(asc(locale === 'ar' ? restaurants.nameAr : restaurants.nameEn)),
  ]);
  const m = (v: number) => formatMoney(v, locale);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);

  return (
    <div className="space-y-6">
      <PageTitle title={t("العمولات والتحصيل", "Commissions & settlements")} subtitle={t("تصل قيمة الطلبات للمطعم مباشرة. هنا تتابع عمولتك وتُسجل ما تم تحصيله.", "Money goes directly to restaurants; this is the platform's commission ledger.")}>
        <form className="flex items-end gap-2">
          <label className="text-xs">{t("من", "From")} <input aria-label={t("من تاريخ", "From date")} type="date" name="from" defaultValue={fromStr} className="input py-1" /></label>
          <label className="text-xs">{t("إلى", "To")} <input aria-label={t("إلى تاريخ", "To date")} type="date" name="to" defaultValue={toStr} className="input py-1" /></label>
          <button className="btn btn-secondary btn-sm">{t("عرض", "Apply")}</button>
        </form>
      </PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("مبيعات الفترة (بعد المرتجعات)", "Sales after refunds (period)")} value={m(sum((r) => r.period.sales))} />
        <Stat label={t("مرتجعات الفترة", "Refunds (period)")} value={m(sum((r) => r.period.refunds))} />
        <Stat label={t("حصة المنصة للفترة", "Platform earnings (period)")} value={m(sum((r) => r.period.commission))} hint={t(`منها رسوم ثابتة ${m(sum((r) => r.period.serviceFees))} وتوصيل ${m(sum((r) => r.period.deliveryFees))}`, `incl. fixed fees ${m(sum((r) => r.period.serviceFees))} and delivery ${m(sum((r) => r.period.deliveryFees))}`)} />
        <Stat label={t("إجمالي ما تم تحصيله", "Commission paid (all time)")} value={m(sum((r) => r.allTime.paid))} />
        <Stat label={t("عمولة مستحقة", "Commission outstanding")} value={m(sum((r) => r.allTime.outstanding))} />
      </div>
      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">{t("حسب المطعم", "By restaurant")}</h2>
        <table className="table">
          <thead><tr><th>{t("المطعم", "Restaurant")}</th><th>{t("النسبة", "Rate")}</th><th>{t("تم التسليم", "Completed")}</th><th>{t("المبيعات", "Sales")}</th><th>{t("المرتجع", "Refunded")}</th><th>{t("الخصومات", "Discounts")}</th><th>{t("حصة المنصة", "Platform share")}</th><th>{t("منها توصيل", "of which delivery")}</th><th>{t("صافي المطعم", "Merchant net")}</th><th>{t("إجمالي العمولة", "All-time commission")}</th><th>{t("تم تحصيله", "Paid")}</th><th>{t("المستحق", "Outstanding")}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.restaurantId}>
                <td className="font-semibold">{localizedName(locale, r.nameAr, r.nameEn)}</td>
                <td>{(r.commissionBps / 100).toFixed(2)}%</td>
                <td>{r.period.completed}</td>
                <td>{m(r.period.sales)}</td>
                <td>{r.period.refunds ? m(r.period.refunds) : '—'}</td>
                <td>{m(r.period.discounts)}</td>
                <td className="font-semibold">{m(r.period.commission)}</td>
                <td>{r.period.deliveryFees ? m(r.period.deliveryFees) : '—'}</td>
                <td>{m(r.period.merchantNet)}</td>
                <td>{m(r.allTime.commission)}</td>
                <td>{m(r.allTime.paid)}</td>
                <td className={r.allTime.outstanding > 0 ? 'font-bold text-amber-700' : ''}>{m(r.allTime.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">{t("حصة المنصة = النسبة + المبلغ الثابت + أجرة توصيل المنصة. الرسوم بتتضاف فوق سعر المطعم؛ وأجرة التوصيل يا إما على العميل يا إما مخصومة من المطعم حسب إعداده. الطلبات القديمة تحتفظ بحسابها. المبالغ بعد التسليم والاسترداد.", "Platform share = percentage + fixed fee + platform delivery charge. Fees are added above the restaurant price; the delivery charge is paid by the customer or deducted from the restaurant per its setting. Legacy orders keep their accounting. Totals are after completion and refunds.")}</p>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-bold">{t("تسجيل عمولة تم تحصيلها", "Record commission received")}</h2>
          <ActionForm action={recordSettlementAction} resetOnSuccess className="grid gap-2 sm:grid-cols-2">
            <select aria-label={t("المطعم", "Restaurant")} name="restaurantId" className="input" required>
              {restaurantList.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
            </select>
            <input aria-label={t("المبلغ بالجنيه", "Amount in EGP")} name="amount" placeholder={t("المبلغ بالجنيه", "Amount EGP")} className="input" inputMode="decimal" required />
            <label className="text-xs">{t("بداية الفترة", "Period start")} <input aria-label={t("بداية الفترة", "Period start")} type="date" name="periodStart" className="input py-1" /></label>
            <label className="text-xs">{t("نهاية الفترة", "Period end")} <input aria-label={t("نهاية الفترة", "Period end")} type="date" name="periodEnd" className="input py-1" /></label>
            <input aria-label={t("ملاحظة", "Note")} name="note" placeholder={t("ملاحظة أو مرجع التحويل", "Note (e.g. InstaPay ref)")} className="input sm:col-span-2" />
            <div className="sm:col-span-2"><SubmitButton>{t("تسجيل التحصيل", "Record payment")}</SubmitButton></div>
          </ActionForm>
          <h3 className="mt-5 mb-2 text-sm font-bold">{t("سجل التحصيل", "History")}</h3>
          <table className="table">
            <tbody>
              {history.map(({ s, restaurant, by }) => (
                <tr key={s.id}>
                  <td className="text-xs text-gray-500">{formatDateTime(s.paidAt, tz, locale)}</td>
                  <td>{restaurant}</td>
                  <td className="font-semibold">{m(s.amountPaid)}</td>
                  <td className="text-xs">{s.periodStart ? `${s.periodStart} → ${s.periodEnd ?? ''}` : ''} {s.note}</td>
                  <td className="text-xs text-gray-500">{by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2 className="mb-2 font-bold">{t("أداء ملصقات الطلب", "Orders by QR poster (utm_source)")}</h2>
          <table className="table">
            <thead><tr><th>{t("الملصق", "Source")}</th><th>{t("الطلبات", "Orders")}</th><th>{t("تم التسليم", "Completed")}</th><th>{t("المبيعات", "Sales")}</th></tr></thead>
            <tbody>
              {sources.map((s) => <tr key={s.source}><td className="font-mono text-xs">{['direct', '(direct)'].includes(s.source) ? t('رابط مباشر', 'Direct link') : s.source}</td><td>{s.orders}</td><td>{s.completed}</td><td>{m(s.sales)}</td></tr>)}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
