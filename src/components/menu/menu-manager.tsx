import Link from 'next/link';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/server/db';
import { addonGroups, addons, categories, products, productVariants } from '@/server/db/schema';
import { saveAddonGroupAction, saveCategoryAction, setProductActiveAction } from '@/server/actions/admin-restaurants';
import { setProductAvailability } from '@/server/actions/merchant';
import { ActionForm, SubmitButton } from '@/components/forms';
import { RowsEditor } from '@/components/admin/editors';
import { formatMoney } from '@/lib/domain/misc';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

/**
 * Full menu editor (categories, products, sizes, add-ons) shared by the platform admin and the
 * restaurant's own owner / manager. Every action re-checks `menu.manage` for this restaurant.
 */
export async function MenuManager({ restaurantId, basePath, showLoad }: { restaurantId: string; basePath: string; showLoad: boolean }) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const [cats, prods, groups] = await Promise.all([
    db().select().from(categories).where(eq(categories.restaurantId, restaurantId)).orderBy(asc(categories.sortOrder)),
    db().select().from(products).where(eq(products.restaurantId, restaurantId)).orderBy(asc(products.sortOrder)),
    db().select().from(addonGroups).where(eq(addonGroups.restaurantId, restaurantId)).orderBy(asc(addonGroups.sortOrder)),
  ]);
  const variants = prods.length ? await db().select().from(productVariants).where(inArray(productVariants.productId, prods.map((p) => p.id))).orderBy(asc(productVariants.sortOrder)) : [];
  const addonRows = groups.length ? await db().select().from(addons).where(inArray(addons.groupId, groups.map((g) => g.id))).orderBy(asc(addons.sortOrder)) : [];

  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <section className="card space-y-3 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{t('الأصناف', 'Products')} ({prods.filter((p) => p.isActive).length})</h2>
          {cats.length > 0 && <Link href={`${basePath}/products/new`} className="btn btn-primary btn-sm">{t('+ صنف جديد', '+ New product')}</Link>}
        </div>
        {cats.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('ابدأ بإضافة قسم (مثلاً: ساندوتشات، مشروبات) من الخانة اللي جنبك، وبعدها أضف الأصناف.', 'Start by adding a category (e.g. Sandwiches, Drinks), then add products.')}</p>}
        {cats.length > 0 && prods.length === 0 && <p className="text-sm text-gray-500">{t('مفيش أصناف لسه. اضغط "+ صنف جديد".', 'No products yet. Press “+ New product”.')}</p>}
        {prods.length > 0 && (
          <table className="table">
            <thead><tr><th className="w-14" /><th>{t('الصنف', 'Product')}</th><th>{t('القسم', 'Category')}</th><th>{t('السعر', 'Price')}</th>{showLoad && <th>{t('جهد التحضير', 'Load units')}</th>}<th>{t('الحالة', 'Status')}</th></tr></thead>
            <tbody>
              {prods.map((p) => {
                const category = cats.find((c) => c.id === p.categoryId);
                const vs = variants.filter((v) => v.productId === p.id);
                return (
                  <tr key={p.id} className={p.isActive ? '' : 'opacity-50'}>
                    <td>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-11 w-11 rounded-lg object-cover" loading="lazy" /> : <div className="h-11 w-11 rounded-lg bg-gray-100" />}
                    </td>
                    <td><Link className="font-semibold text-blue-700" href={`${basePath}/products/${p.id}`}>{localizedName(locale, p.nameAr, p.nameEn)}</Link></td>
                    <td>{localizedName(locale, category?.nameAr, category?.nameEn)}</td>
                    <td className="text-sm">{vs.length ? vs.map((v) => `${localizedName(locale, v.nameAr, v.nameEn)} ${formatMoney(v.price, locale)}`).join(' · ') : formatMoney(p.basePrice, locale)}</td>
                    {showLoad && <td>{p.prepLoadUnits}</td>}
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {p.isActive && (
                          <form action={setProductAvailability.bind(null, p.id, !p.isAvailable)}>
                            <button className={`btn btn-sm ${p.isAvailable ? 'btn-success' : 'btn-secondary'}`} title={t('تغيير التوفر — يظهر فورًا للعميل', 'Toggle availability (customers see it instantly)')}>{p.isAvailable ? t('متاح', 'Available') : t('غير متاح', 'Unavailable')}</button>
                          </form>
                        )}
                        <form action={setProductActiveAction.bind(null, p.id, !p.isActive)}>
                          <button className="btn btn-ghost btn-sm">{p.isActive ? t('إخفاء', 'Archive') : t('إظهار', 'Restore')}</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <div className="space-y-6">
        <section className="card">
          <h2 className="mb-1 font-bold">{t('الأقسام', 'Categories')}</h2>
          <p className="mb-3 text-xs text-gray-500">{t('الترتيب: الرقم الأصغر يظهر الأول.', 'Order: smaller numbers show first.')}</p>
          <div className="space-y-2">
            {[...cats, null].map((c, i) => (
              <ActionForm key={c?.id ?? `new-${i}`} action={saveCategoryAction} className="grid grid-cols-[1fr_1fr_60px] items-center gap-2">
                <input type="hidden" name="restaurantId" value={restaurantId} />
                <input type="hidden" name="id" value={c?.id ?? ''} />
                <input aria-label={t('الاسم بالعربي', 'Name in Arabic')} name="nameAr" defaultValue={c?.nameAr ?? ''} placeholder={t('الاسم بالعربي', 'Name in Arabic')} className="input py-1" dir="rtl" required />
                <input aria-label={t('الاسم بالإنجليزي', 'Name in English')} name="nameEn" defaultValue={c?.nameEn ?? ''} placeholder={t('إنجليزي', 'English')} className="input py-1" required />
                <input name="sortOrder" defaultValue={c?.sortOrder ?? cats.length + 1} className="input py-1" aria-label={t('ترتيب العرض', 'Sort')} inputMode="numeric" />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={c?.isActive ?? true} /> {t('ظاهر للعميل', 'visible')}</label>
                <SubmitButton className="btn btn-secondary btn-sm col-span-2">{c ? t('حفظ', 'Save') : t('إضافة قسم', 'Add category')}</SubmitButton>
              </ActionForm>
            ))}
          </div>
        </section>
        <section className="card">
          <h2 className="mb-1 font-bold">{t('الإضافات', 'Add-ons')}</h2>
          <p className="mb-3 text-xs text-gray-500">{t('مثلاً "صوصات" أو "إضافات": اعمل المجموعة هنا، وبعدين اربطها بالأصناف من صفحة الصنف.', 'E.g. “Sauces” or “Extras”: create the group here, then link it to products from the product page.')}</p>
          <div className="space-y-4">
            {[...groups, null].map((g, i) => (
              <ActionForm key={g?.id ?? `new-${i}`} action={saveAddonGroupAction} className="space-y-2 rounded-xl bg-gray-50 p-3">
                <input type="hidden" name="restaurantId" value={restaurantId} />
                <input type="hidden" name="id" value={g?.id ?? ''} />
                <div className="grid grid-cols-2 gap-2">
                  <input aria-label={t('الاسم بالعربي', 'Name in Arabic')} name="nameAr" defaultValue={g?.nameAr ?? ''} placeholder={t('اسم المجموعة بالعربي', 'Group name in Arabic')} className="input py-1" dir="rtl" required />
                  <input aria-label={t('الاسم بالإنجليزي', 'Name in English')} name="nameEn" defaultValue={g?.nameEn ?? ''} placeholder={t('اسم المجموعة بالإنجليزي', 'Group name')} className="input py-1" required />
                  <label className="text-xs">{t('أقل عدد اختيارات', 'Min select')} <input aria-label={t('أقل عدد اختيارات', 'Minimum selections')} name="minSelect" defaultValue={g?.minSelect ?? 0} className="input py-1" inputMode="numeric" /></label>
                  <label className="text-xs">{t('أقصى اختيارات — صفر بلا حد', 'Max select (0 = no limit)')} <input aria-label={t('أقصى عدد اختيارات', 'Maximum selections')} name="maxSelect" defaultValue={g?.maxSelect ?? 1} className="input py-1" inputMode="numeric" /></label>
                </div>
                <input type="hidden" name="sortOrder" value={g?.sortOrder ?? groups.length + 1} />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={g?.isActive ?? true} /> {t('نشط', 'active')}</label>
                <RowsEditor
                  name="addons"
                  addLabel={t('إضافة اختيار', 'Add option')}
                  columns={[
                    { key: 'nameAr', label: t('عربي', 'Arabic'), type: 'text', dir: 'rtl' },
                    { key: 'nameEn', label: t('إنجليزي', 'English'), type: 'text' },
                    { key: 'price', label: t('جنيه', 'EGP'), type: 'number', width: '80px' },
                    { key: 'isAvailable', label: t('متاح', 'On'), type: 'checkbox', width: '40px' },
                  ]}
                  initial={addonRows.filter((a) => a.groupId === g?.id).map((a) => ({ id: a.id, nameAr: a.nameAr, nameEn: a.nameEn, price: String(a.price / 100), isAvailable: a.isAvailable }))}
                  blank={{ nameAr: '', nameEn: '', price: '0', isAvailable: true }}
                />
                <SubmitButton className="btn btn-secondary btn-sm">{g ? t('حفظ المجموعة', 'Save group') : t('إضافة مجموعة', 'Add group')}</SubmitButton>
              </ActionForm>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
