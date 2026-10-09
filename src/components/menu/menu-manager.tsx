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

  const activeProducts = prods.filter((p) => p.isActive);
  const steps = [
    { done: cats.length > 0, title: t('اعمل الأقسام', 'Create categories'), body: t('القسم هو العنوان اللي بيجمع الأصناف، زي «ساندوتشات» أو «مشروبات». اكتب اسمه في خانة «الأقسام» واضغط «إضافة قسم».', 'A category groups items, like “Sandwiches” or “Drinks”. Type it under “Categories” and press “Add category”.') },
    { done: activeProducts.length > 0, title: t('ضيف الأصناف', 'Add your items'), body: t('اضغط «+ صنف جديد»: اكتب الاسم والسعر واختار القسم. ده كفاية عشان الصنف يظهر للعملاء.', 'Press “+ New product”: name, price and category are enough for it to show to customers.') },
    { done: activeProducts.some((p) => p.imageUrl), title: t('حط صور', 'Add photos'), body: t('صورة واضحة بتزوّد الطلبات. افتح الصنف واضغط «رفع صورة» من موبايلك مباشرة.', 'A clear photo sells. Open an item and tap “Upload photo” straight from your phone.') },
    { done: groups.length > 0 || variants.length > 0, optional: true, title: t('أحجام وإضافات (لو محتاج)', 'Sizes & add-ons (if needed)'), body: t('صغير/كبير بتتضاف جوه صفحة الصنف. الإضافات زي «جبنة زيادة» بتتعمل من خانة «الإضافات» وبعدين تعلّم عليها في الصنف.', 'Small/large are added on the item page. Extras like “extra cheese” are made under “Add-ons”, then ticked on the item.') },
  ];
  const allDone = steps.filter((x) => !x.optional).every((x) => x.done);
  return (
    <div className="space-y-6">
    <details className="card" open={!allDone || undefined}>
      <summary className="cursor-pointer font-bold">{allDone ? t('✓ المنيو جاهز — خطوات الإعداد', '✓ Menu ready — setup steps') : t('إزاي تعمل المنيو؟ ٤ خطوات بسيطة', 'How to build your menu — 4 simple steps')}</summary>
      <ol className="mt-3 grid gap-3 md:grid-cols-2">
        {steps.map((x, i) => (
          <li key={i} className={`flex gap-3 rounded-xl p-3 ${x.done ? 'bg-emerald-50' : 'bg-gray-50'}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${x.done ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}>{x.done ? '✓' : i + 1}</span>
            <span className="text-sm"><b className="block">{x.title}{x.optional ? <small className="font-normal text-gray-500"> · {t('اختياري', 'optional')}</small> : null}</b><span className="text-gray-600">{x.body}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-gray-500">{t('الاسم بالإنجليزي اختياري في كل حتة؛ لو سبته فاضي هيظهر الاسم العربي.', 'English names are optional everywhere; if empty the Arabic name is shown.')}</p>
    </details>
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
          <p className="mb-3 text-xs text-gray-500">{t('اكتب اسم القسم بالعربي (الإنجليزي اختياري). «الترتيب»: رقم أصغر = يظهر الأول. شيل علامة «ظاهر» عشان تخفي القسم من غير ما تمسحه.', 'Arabic name (English optional). “Order”: smaller shows first. Untick “visible” to hide a category without deleting it.')}</p>
          <div className="mb-1 grid grid-cols-[1fr_1fr_60px] gap-2 text-[11px] font-semibold text-gray-500"><span>{t('بالعربي', 'Arabic')}</span><span>{t('بالإنجليزي (اختياري)', 'English (optional)')}</span><span>{t('الترتيب', 'Order')}</span></div>
          <div className="space-y-2">
            {[...cats, null].map((c, i) => (
              <ActionForm key={c?.id ?? `new-${i}`} action={saveCategoryAction} className="grid grid-cols-[1fr_1fr_60px] items-center gap-2">
                <input type="hidden" name="restaurantId" value={restaurantId} />
                <input type="hidden" name="id" value={c?.id ?? ''} />
                <input aria-label={t('الاسم بالعربي', 'Name in Arabic')} name="nameAr" defaultValue={c?.nameAr ?? ''} placeholder={c ? '' : t('مثلاً: ساندوتشات', 'e.g. Sandwiches')} className="input py-1" dir="rtl" required />
                <input aria-label={t('الاسم بالإنجليزي (اختياري)', 'Name in English (optional)')} name="nameEn" defaultValue={c?.nameEn ?? ''} placeholder={t('اختياري', 'optional')} className="input py-1" dir="ltr" />
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
                  <input aria-label={t('الاسم بالعربي', 'Name in Arabic')} name="nameAr" defaultValue={g?.nameAr ?? ''} placeholder={t('مثلاً: صوصات', 'e.g. Sauces')} className="input py-1" dir="rtl" required />
                  <input aria-label={t('الاسم بالإنجليزي (اختياري)', 'Name in English (optional)')} name="nameEn" defaultValue={g?.nameEn ?? ''} placeholder={t('بالإنجليزي (اختياري)', 'English (optional)')} className="input py-1" dir="ltr" />
                  <label className="text-xs">{t('أقل عدد لازم يختاره (0 = اختياري)', 'Minimum to choose (0 = optional)')} <input aria-label={t('أقل عدد اختيارات', 'Minimum selections')} name="minSelect" defaultValue={g?.minSelect ?? 0} className="input py-1" inputMode="numeric" /></label>
                  <label className="text-xs">{t('أقصى عدد يختاره (0 = مفتوح)', 'Maximum (0 = no limit)')} <input aria-label={t('أقصى عدد اختيارات', 'Maximum selections')} name="maxSelect" defaultValue={g?.maxSelect ?? 1} className="input py-1" inputMode="numeric" /></label>
                </div>
                <input type="hidden" name="sortOrder" value={g?.sortOrder ?? groups.length + 1} />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={g?.isActive ?? true} /> {t('نشط', 'active')}</label>
                <RowsEditor
                  name="addons"
                  addLabel={t('إضافة اختيار', 'Add option')}
                  columns={[
                    { key: 'nameAr', label: t('عربي', 'Arabic'), type: 'text', dir: 'rtl' },
                    { key: 'nameEn', label: t('إنجليزي (اختياري)', 'English (opt.)'), type: 'text' },
                    { key: 'price', label: t('سعرها بالجنيه', 'Price EGP'), type: 'number', width: '80px' },
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
    </div>
  );
}
