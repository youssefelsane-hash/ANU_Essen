import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { desc, ilike, or } from 'drizzle-orm';
import { db } from '@/server/db';
import { customers } from '@/server/db/schema';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { Forbidden, PageTitle, Pagination } from '@/components/admin/ui';
import { formatDateTime } from '@/lib/domain/misc';

export const dynamic = 'force-dynamic';
const PAGE = 50;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/customers', 'platform.restaurants'))) return <Forbidden />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const tz = await platformTimezone();
  const q = sp.q?.trim().slice(0, 40);
  const list = await db()
    .select()
    .from(customers)
    .where(q ? or(ilike(customers.phone, `%${q}%`), ilike(customers.name, `%${q}%`)) : undefined)
    .orderBy(desc(customers.lastOrderAt))
    .limit(PAGE + 1)
    .offset((page - 1) * PAGE);
  return (
    <div>
      <PageTitle title={t("العملاء", "Customers")} subtitle={t("الطلب متاح دون حساب. رقم الهاتف يربط طلبات العميل.", "Guest checkout — customers are identified by phone number.")} />
      <form className="mb-4 flex gap-2"><input aria-label={t("بحث", "Search")} name="q" defaultValue={q ?? ''} placeholder={t("رقم الهاتف أو الاسم", "Phone or name")} className="input max-w-xs" /><button className="btn btn-secondary">{t("بحث", "Search")}</button></form>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>{t("الاسم", "Name")}</th><th>{t("الهاتف", "Phone")}</th><th>{t("الطلبات", "Orders")}</th><th>{t("آخر طلب", "Last order")}</th><th>{t("أول طلب", "First seen")}</th></tr></thead>
          <tbody>
            {list.slice(0, PAGE).map((c) => (
              <tr key={c.id}><td>{c.name}</td><td className="font-mono">{c.phone}</td><td>{c.ordersCount}</td><td className="text-xs">{c.lastOrderAt ? formatDateTime(c.lastOrderAt, tz, locale) : '—'}</td><td className="text-xs">{formatDateTime(c.createdAt, tz, locale)}</td></tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} hasMore={list.length > PAGE} base={`/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`} />
      </section>
    </div>
  );
}
