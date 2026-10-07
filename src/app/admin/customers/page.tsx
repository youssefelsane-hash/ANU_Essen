import { desc, ilike, or } from 'drizzle-orm';
import { db } from '@/server/db';
import { customers } from '@/server/db/schema';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { Forbidden, PageTitle, Pagination } from '@/components/admin/ui';
import { formatDateTime } from '@/lib/domain/misc';

export const dynamic = 'force-dynamic';
const PAGE = 50;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
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
      <PageTitle title="Customers" subtitle="Guest checkout — customers are identified by phone number." />
      <form className="mb-4 flex gap-2"><input name="q" defaultValue={q ?? ''} placeholder="Phone or name" className="input max-w-xs" /><button className="btn btn-secondary">Search</button></form>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Orders</th><th>Last order</th><th>First seen</th></tr></thead>
          <tbody>
            {list.slice(0, PAGE).map((c) => (
              <tr key={c.id}><td>{c.name}</td><td className="font-mono">{c.phone}</td><td>{c.ordersCount}</td><td className="text-xs">{c.lastOrderAt ? formatDateTime(c.lastOrderAt, tz) : '—'}</td><td className="text-xs">{formatDateTime(c.createdAt, tz)}</td></tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} hasMore={list.length > PAGE} base={`/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`} />
      </section>
    </div>
  );
}
