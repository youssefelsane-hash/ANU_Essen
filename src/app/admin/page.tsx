import { getLocale } from '@/lib/i18n/server';
import { text, localizedName, labels } from '@/lib/i18n';
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders, restaurants } from '@/server/db/schema';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { activeCounts, financeByRestaurant, periodStats } from '@/server/services/stats';
import { Forbidden, PageTitle, Stat } from '@/components/admin/ui';
import { startOfLocalDay } from '@/lib/domain/hours';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import { STATUS_TONE } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const auth = await adminPage('/admin', 'platform.finance');
  if (!auth) return <Forbidden />;
  const tz = await platformTimezone();
  const from = startOfLocalDay(new Date(), tz);
  const to = new Date(from.getTime() + 24 * 3600_000);
  const [today, active, finance, latest] = await Promise.all([
    periodStats(db(), from, to),
    activeCounts(db()),
    financeByRestaurant(db(), from, to),
    db()
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, total: orders.total, createdAt: orders.createdAt, restaurant: locale === 'ar' ? restaurants.nameAr : restaurants.nameEn, customer: orders.customerName })
      .from(orders)
      .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
      .orderBy(desc(orders.createdAt))
      .limit(10),
  ]);
  const activeTotal = Object.values(active).reduce((s, n) => s + (n ?? 0), 0);
  const all = finance.reduce((acc, f) => ({ sales: acc.sales + f.allTime.sales, commission: acc.commission + f.allTime.commission, paid: acc.paid + f.allTime.paid, outstanding: acc.outstanding + f.allTime.outstanding }), { sales: 0, commission: 0, paid: 0, outstanding: 0 });
  const m = (v: number) => formatMoney(v, locale);

  return (
    <div className="space-y-6">
      <PageTitle title={t("نظرة عامة", "Overview")} subtitle={t(`اليوم حسب توقيت ${tz}. المبيعات تُحسب بعد تسليم الطلب.`, `Today in ${tz}. Sales are counted after orders are completed.`)} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label={t("طلبات اليوم", "Orders today")} value={today.orders} />
        <Stat label={t("مبيعات اليوم", "Sales today")} value={m(today.sales)} />
        <Stat label={t("عمولة اليوم", "Platform revenue today")} value={m(today.commission)} />
        <Stat label={t("طلبات قيد التنفيذ", "Active orders (now)")} value={activeTotal} />
        <Stat label={t("تم تسليمها اليوم", "Completed today")} value={today.completed} />
        <Stat label={t("عمولة مستحقة", "Commission outstanding")} value={m(all.outstanding)} />
      </div>
      <section className="card"><h2 className="mb-3 font-bold">{t('ابدأ من هنا', 'Start here')}</h2><div className="flex flex-wrap gap-3">
        {auth.platformPermissions.has('platform.restaurants') && <><Link className="btn btn-primary" href="/admin/restaurants">{t('إدارة المطاعم والمنيو', 'Manage restaurants & menus')}</Link><Link className="btn btn-secondary" href="/admin/orders">{t('متابعة الطلبات', 'Follow orders')}</Link></>}
        <Link className="btn btn-secondary" href="/admin/finance">{t('تسجيل عمولة مستلمة', 'Record commission received')}</Link>
      </div></section>
      <details className="card admin-details"><summary>{t('تفاصيل مالية إضافية', 'More financial details')}</summary><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label={t('إجمالي المبيعات', 'All-time sales')} value={m(all.sales)} />
        <Stat label={t('إجمالي عمولة المنصة', 'All-time commission')} value={m(all.commission)} />
        <Stat label={t('عمولة تم تحصيلها', 'Commission received')} value={m(all.paid)} />
        <Stat label={t('متوسط الطلب اليوم', 'Average order today')} value={m(today.avgOrder)} />
        <Stat label={t('طلبات ملغية اليوم', 'Cancelled today')} value={today.cancelled} />
        <Stat label={t('خصومات اليوم', 'Discounts today')} value={m(today.discounts)} />
      </div></details>
      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">{t("المطاعم اليوم", "Restaurants today")}</h2>
        <table className="table">
          <thead><tr><th>{t("المطعم", "Restaurant")}</th><th>{t("تم التسليم", "Completed")}</th><th>{t("المبيعات", "Sales")}</th><th>{t("العمولة", "Commission")}</th><th>{t("إجمالي المستحق", "Outstanding (all time)")}</th></tr></thead>
          <tbody>
            {finance.map((f) => (
              <tr key={f.restaurantId}>
                <td><Link className="text-blue-700" href={`/admin/restaurants/${f.restaurantId}`}>{localizedName(locale, f.nameAr, f.nameEn)}</Link></td>
                <td>{f.period.completed}</td>
                <td>{m(f.period.sales)}</td>
                <td>{m(f.period.commission)}</td>
                <td className={f.allTime.outstanding > 0 ? 'font-semibold text-amber-700' : ''}>{m(f.allTime.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">{t("آخر الطلبات", "Latest orders")}</h2>
        <table className="table">
          <tbody>
            {latest.map((o) => (
              <tr key={o.id}>
                <td><Link className="font-bold text-blue-700" href={`/admin/orders/${o.id}`}>#{o.orderNumber}</Link></td>
                <td>{o.restaurant}</td>
                <td>{o.customer}</td>
                <td><span className={`badge ${STATUS_TONE[o.status]}`}>{labels(locale).status[o.status]}</span></td>
                <td>{m(o.total)}</td>
                <td className="text-xs text-gray-500">{formatDateTime(o.createdAt, tz, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
