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
      .select({ s: settlements, restaurant: restaurants.nameEn, by: users.name })
      .from(settlements)
      .innerJoin(restaurants, eq(restaurants.id, settlements.restaurantId))
      .leftJoin(users, eq(users.id, settlements.recordedByUserId))
      .orderBy(desc(settlements.paidAt))
      .limit(50),
    db().select({ id: restaurants.id, nameEn: restaurants.nameEn }).from(restaurants).orderBy(asc(restaurants.nameEn)),
  ]);
  const m = (v: number) => formatMoney(v, 'en');
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);

  return (
    <div className="space-y-6">
      <PageTitle title="Commissions & settlements" subtitle="Money goes directly to restaurants; this is the platform's commission ledger.">
        <form className="flex items-end gap-2">
          <label className="text-xs">From <input type="date" name="from" defaultValue={fromStr} className="input py-1" /></label>
          <label className="text-xs">To <input type="date" name="to" defaultValue={toStr} className="input py-1" /></label>
          <button className="btn btn-secondary btn-sm">Apply</button>
        </form>
      </PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gross sales (period)" value={m(sum((r) => r.period.sales))} />
        <Stat label="Platform commission (period)" value={m(sum((r) => r.period.commission))} />
        <Stat label="Commission paid (all time)" value={m(sum((r) => r.allTime.paid))} />
        <Stat label="Commission outstanding" value={m(sum((r) => r.allTime.outstanding))} />
      </div>
      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-bold">By restaurant</h2>
        <table className="table">
          <thead><tr><th>Restaurant</th><th>Rate</th><th>Completed</th><th>Gross sales</th><th>Discounts</th><th>Commission</th><th>Merchant net</th><th>All-time commission</th><th>Paid</th><th>Outstanding</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.restaurantId}>
                <td className="font-semibold">{r.nameEn}</td>
                <td>{(r.commissionBps / 100).toFixed(2)}%</td>
                <td>{r.period.completed}</td>
                <td>{m(r.period.sales)}</td>
                <td>{m(r.period.discounts)}</td>
                <td className="font-semibold">{m(r.period.commission)}</td>
                <td>{m(r.period.merchantNet)}</td>
                <td>{m(r.allTime.commission)}</td>
                <td>{m(r.allTime.paid)}</td>
                <td className={r.allTime.outstanding > 0 ? 'font-bold text-amber-700' : ''}>{m(r.allTime.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">Commission = (subtotal − discount) × the rate snapshotted on each order. Counted when the order is completed.</p>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-bold">Record commission received</h2>
          <ActionForm action={recordSettlementAction} resetOnSuccess className="grid gap-2 sm:grid-cols-2">
            <select name="restaurantId" className="input" required>
              {restaurantList.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
            </select>
            <input name="amount" placeholder="Amount EGP" className="input" inputMode="decimal" required />
            <label className="text-xs">Period start <input type="date" name="periodStart" className="input py-1" /></label>
            <label className="text-xs">Period end <input type="date" name="periodEnd" className="input py-1" /></label>
            <input name="note" placeholder="Note (e.g. InstaPay ref)" className="input sm:col-span-2" />
            <div className="sm:col-span-2"><SubmitButton>Record payment</SubmitButton></div>
          </ActionForm>
          <h3 className="mt-5 mb-2 text-sm font-bold">History</h3>
          <table className="table">
            <tbody>
              {history.map(({ s, restaurant, by }) => (
                <tr key={s.id}>
                  <td className="text-xs text-gray-500">{formatDateTime(s.paidAt, tz)}</td>
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
          <h2 className="mb-2 font-bold">Orders by QR poster (utm_source)</h2>
          <table className="table">
            <thead><tr><th>Source</th><th>Orders</th><th>Completed</th><th>Sales</th></tr></thead>
            <tbody>
              {sources.map((s) => <tr key={s.source}><td className="font-mono text-xs">{s.source}</td><td>{s.orders}</td><td>{s.completed}</td><td>{m(s.sales)}</td></tr>)}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
