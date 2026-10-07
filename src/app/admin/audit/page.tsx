import { and, desc, eq, ilike, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { auditLogs, restaurants } from '@/server/db/schema';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { Forbidden, PageTitle, Pagination } from '@/components/admin/ui';
import { formatDateTime } from '@/lib/domain/misc';

export const dynamic = 'force-dynamic';
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; restaurant?: string; page?: string }> }) {
  if (!(await adminPage('/admin/audit', 'platform.audit'))) return <Forbidden />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const tz = await platformTimezone();
  const where: SQL[] = [];
  if (sp.action) where.push(ilike(auditLogs.action, `%${sp.action.slice(0, 40)}%`));
  if (sp.restaurant) where.push(eq(auditLogs.restaurantId, sp.restaurant));
  const [rows, restaurantList] = await Promise.all([
    db()
      .select({ a: auditLogs, restaurant: restaurants.nameEn })
      .from(auditLogs)
      .leftJoin(restaurants, eq(restaurants.id, auditLogs.restaurantId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(PAGE + 1)
      .offset((page - 1) * PAGE),
    db().select({ id: restaurants.id, nameEn: restaurants.nameEn }).from(restaurants),
  ]);
  const qs = new URLSearchParams(Object.entries({ action: sp.action ?? '', restaurant: sp.restaurant ?? '' }).filter(([, v]) => v)).toString();
  return (
    <div>
      <PageTitle title="Audit log" subtitle="Who changed what, when — prices, payments, cancellations, commissions, queue settings, staff." />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="action" defaultValue={sp.action ?? ''} placeholder="action contains… (e.g. price, verify, commission)" className="input max-w-sm" />
        <select name="restaurant" defaultValue={sp.restaurant ?? ''} className="input max-w-xs">
          <option value="">All restaurants</option>
          {restaurantList.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
        </select>
        <button className="btn btn-secondary">Filter</button>
      </form>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Restaurant</th><th>Change</th><th>IP / device</th></tr></thead>
          <tbody>
            {rows.slice(0, PAGE).map(({ a, restaurant }) => (
              <tr key={a.id}>
                <td className="text-xs whitespace-nowrap text-gray-500">{formatDateTime(a.createdAt, tz)}</td>
                <td className="text-sm">{a.actorLabel ?? a.actorType}<div className="text-xs text-gray-400">{a.actorType}</div></td>
                <td><code className="text-xs">{a.action}</code></td>
                <td className="text-xs">{a.entity}<div className="font-mono text-[10px] text-gray-400">{a.entityId?.slice(0, 8)}</div></td>
                <td className="text-xs">{restaurant ?? '—'}</td>
                <td className="max-w-md">
                  <details>
                    <summary className="cursor-pointer text-xs text-blue-700">view</summary>
                    <pre className="mt-1 max-h-60 overflow-auto rounded bg-gray-50 p-2 text-[11px]">{JSON.stringify({ before: a.before, after: a.after }, null, 2)}</pre>
                  </details>
                </td>
                <td className="text-[11px] text-gray-500">{a.ip}{a.deviceId ? ` · ${a.deviceId.slice(0, 8)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} hasMore={rows.length > PAGE} base={`/admin/audit${qs ? `?${qs}` : ''}`} />
      </section>
    </div>
  );
}
