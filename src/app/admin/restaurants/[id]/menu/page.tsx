import Link from 'next/link';
import { asc, eq, inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { addonGroups, addons, categories, products, productVariants } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant } from '@/server/services/store';
import { saveAddonGroupAction, saveCategoryAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { RowsEditor } from '@/components/admin/editors';
import { Forbidden, PageTitle, RestaurantTabs } from '@/components/admin/ui';
import { formatMoney } from '@/lib/domain/misc';

export const dynamic = 'force-dynamic';

export default async function AdminMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (!(await adminPage(`/admin/restaurants/${id}/menu`, 'platform.restaurants'))) return <Forbidden />;
  const r = await getRestaurant(db(), id);
  if (!r) notFound();
  const [cats, prods, groups] = await Promise.all([
    db().select().from(categories).where(eq(categories.restaurantId, id)).orderBy(asc(categories.sortOrder)),
    db().select().from(products).where(eq(products.restaurantId, id)).orderBy(asc(products.sortOrder)),
    db().select().from(addonGroups).where(eq(addonGroups.restaurantId, id)).orderBy(asc(addonGroups.sortOrder)),
  ]);
  const variants = prods.length ? await db().select().from(productVariants).where(inArray(productVariants.productId, prods.map((p) => p.id))) : [];
  const addonRows = groups.length ? await db().select().from(addons).where(inArray(addons.groupId, groups.map((g) => g.id))).orderBy(asc(addons.sortOrder)) : [];

  return (
    <div>
      <PageTitle title={`${r.nameEn} — Menu`}>
        <Link href={`/admin/restaurants/${id}/menu/products/new`} className="btn btn-primary btn-sm">+ New product</Link>
      </PageTitle>
      <RestaurantTabs id={id} active="menu" />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="card overflow-x-auto">
          <h2 className="mb-2 font-bold">Products</h2>
          <table className="table">
            <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Load units</th><th>Status</th></tr></thead>
            <tbody>
              {prods.map((p) => {
                const vs = variants.filter((v) => v.productId === p.id);
                return (
                  <tr key={p.id} className={p.isActive ? '' : 'opacity-50'}>
                    <td><Link className="font-semibold text-blue-700" href={`/admin/restaurants/${id}/menu/products/${p.id}`}>{p.nameEn}</Link><div className="text-xs text-gray-500" dir="rtl">{p.nameAr}</div></td>
                    <td>{cats.find((c) => c.id === p.categoryId)?.nameEn}</td>
                    <td>{vs.length ? vs.map((v) => `${v.nameEn} ${formatMoney(v.price, 'en')}`).join(' · ') : formatMoney(p.basePrice, 'en')}</td>
                    <td>{p.prepLoadUnits}</td>
                    <td>{!p.isActive ? 'Archived' : p.isAvailable ? 'Available' : 'Unavailable'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <div className="space-y-6">
          <section className="card">
            <h2 className="mb-3 font-bold">Categories</h2>
            <div className="space-y-2">
              {[...cats, null].map((c, i) => (
                <ActionForm key={c?.id ?? `new-${i}`} action={saveCategoryAction} className="grid grid-cols-[1fr_1fr_60px] items-center gap-2">
                  <input type="hidden" name="restaurantId" value={id} />
                  <input type="hidden" name="id" value={c?.id ?? ''} />
                  <input name="nameAr" defaultValue={c?.nameAr ?? ''} placeholder="عربي" className="input py-1" dir="rtl" required />
                  <input name="nameEn" defaultValue={c?.nameEn ?? ''} placeholder="English" className="input py-1" required />
                  <input name="sortOrder" defaultValue={c?.sortOrder ?? cats.length + 1} className="input py-1" aria-label="Sort" />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={c?.isActive ?? true} /> visible</label>
                  <SubmitButton className="btn btn-secondary btn-sm col-span-2">{c ? 'Save' : 'Add category'}</SubmitButton>
                </ActionForm>
              ))}
            </div>
          </section>
          <section className="card">
            <h2 className="mb-3 font-bold">Addon groups</h2>
            <div className="space-y-4">
              {[...groups, null].map((g, i) => (
                <ActionForm key={g?.id ?? `new-${i}`} action={saveAddonGroupAction} className="space-y-2 rounded-xl bg-gray-50 p-3">
                  <input type="hidden" name="restaurantId" value={id} />
                  <input type="hidden" name="id" value={g?.id ?? ''} />
                  <div className="grid grid-cols-2 gap-2">
                    <input name="nameAr" defaultValue={g?.nameAr ?? ''} placeholder="اسم المجموعة" className="input py-1" dir="rtl" required />
                    <input name="nameEn" defaultValue={g?.nameEn ?? ''} placeholder="Group name" className="input py-1" required />
                    <label className="text-xs">Min select <input name="minSelect" defaultValue={g?.minSelect ?? 0} className="input py-1" /></label>
                    <label className="text-xs">Max select (0 = no limit) <input name="maxSelect" defaultValue={g?.maxSelect ?? 1} className="input py-1" /></label>
                  </div>
                  <input type="hidden" name="sortOrder" value={g?.sortOrder ?? groups.length + 1} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={g?.isActive ?? true} /> active</label>
                  <RowsEditor
                    name="addons"
                    addLabel="Add option"
                    columns={[
                      { key: 'nameAr', label: 'Arabic', type: 'text', dir: 'rtl' },
                      { key: 'nameEn', label: 'English', type: 'text' },
                      { key: 'price', label: 'EGP', type: 'number', width: '80px' },
                      { key: 'isAvailable', label: 'On', type: 'checkbox', width: '40px' },
                    ]}
                    initial={addonRows.filter((a) => a.groupId === g?.id).map((a) => ({ id: a.id, nameAr: a.nameAr, nameEn: a.nameEn, price: String(a.price / 100), isAvailable: a.isAvailable }))}
                    blank={{ nameAr: '', nameEn: '', price: '0', isAvailable: true }}
                  />
                  <SubmitButton className="btn btn-secondary btn-sm">{g ? 'Save group' : 'Add group'}</SubmitButton>
                </ActionForm>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
