import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { db } from '@/server/db';
import { restaurants } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { createRestaurantAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function RestaurantsPage() {
  if (!(await adminPage('/admin/restaurants', 'platform.restaurants'))) return <Forbidden />;
  const list = await db().select().from(restaurants).orderBy(asc(restaurants.nameEn));
  return (
    <div className="space-y-6">
      <PageTitle title="Restaurants" subtitle="Each restaurant gets its own menu, queue engine, payments, staff and QR codes." />
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Public URL</th><th>Status</th><th>Commission</th><th>Active</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/admin/restaurants/${r.id}`} className="font-semibold text-blue-700">{r.nameEn}</Link> <span className="text-gray-500">{r.nameAr}</span></td>
                <td><a href={`/s/${r.slug}`} target="_blank" className="font-mono text-xs text-blue-700">/s/{r.slug}</a></td>
                <td>{r.orderingStatus}</td>
                <td>{(r.commissionBps / 100).toFixed(2)}%</td>
                <td>{r.isActive ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2 className="mb-3 font-bold">New restaurant</h2>
        <ActionForm action={createRestaurantAction} className="grid gap-3 md:grid-cols-4">
          <input name="nameAr" placeholder="Name (Arabic)" required className="input" dir="rtl" />
          <input name="nameEn" placeholder="Name (English)" required className="input" />
          <input name="slug" placeholder="url-slug (optional)" className="input" />
          <SubmitButton>Create</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-gray-500">Created with the default queue config &amp; commission from System settings. Cash is enabled; configure InstaPay before enabling it.</p>
      </section>
    </div>
  );
}
