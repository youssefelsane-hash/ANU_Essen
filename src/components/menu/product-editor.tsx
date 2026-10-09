import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { addonGroups, categories, productAddonGroups, products, productVariants } from '@/server/db/schema';
import { saveProductAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { RowsEditor } from '@/components/admin/editors';
import { ImageField } from './image-field';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

/** Create / edit one product. `surface` decides where the form returns after creating. */
export async function ProductEditor({ restaurantId, productId, basePath, surface, canLoad }: { restaurantId: string; productId: string | null; basePath: string; surface: 'admin' | 'merchant'; canLoad: boolean }) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const [cats, groups] = await Promise.all([
    db().select().from(categories).where(eq(categories.restaurantId, restaurantId)).orderBy(asc(categories.sortOrder)),
    db().select().from(addonGroups).where(eq(addonGroups.restaurantId, restaurantId)).orderBy(asc(addonGroups.sortOrder)),
  ]);
  const [p] = productId ? await db().select().from(products).where(and(eq(products.id, productId), eq(products.restaurantId, restaurantId))) : [null];
  if (productId && !p) notFound();
  const variants = p ? await db().select().from(productVariants).where(eq(productVariants.productId, p.id)).orderBy(asc(productVariants.sortOrder)) : [];
  const linked = p ? (await db().select().from(productAddonGroups).where(eq(productAddonGroups.productId, p.id))).map((l) => l.groupId) : [];

  return (
    <div className="max-w-3xl space-y-3">
      <Link href={basePath} className="text-sm text-blue-700">{t('← العودة للمنيو', '← Menu')}</Link>
      <h1 className="text-2xl font-black">{p ? localizedName(locale, p.nameAr, p.nameEn) : t('صنف جديد', 'New product')}</h1>
      {cats.length === 0 ? (
        <p className="card">{t('أضف قسمًا أولًا حتى تضع الصنف فيه.', 'Create a category first.')}</p>
      ) : (
        <ActionForm action={saveProductAction} className="card grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <input type="hidden" name="id" value={p?.id ?? ''} />
          <input type="hidden" name="surface" value={surface} />
          <div><label className="label" htmlFor="product-name-ar">{t('الاسم بالعربي', 'Name (Arabic)')}</label><input id="product-name-ar" name="nameAr" defaultValue={p?.nameAr} className="input" dir="rtl" required maxLength={80} placeholder={t('مثلاً: ساندوتش شاورما فراخ', 'e.g. Chicken shawarma sandwich')} /></div>
          <div><label className="label" htmlFor="product-name-en">{t('الاسم بالإنجليزي (اختياري)', 'Name (English, optional)')}</label><input id="product-name-en" name="nameEn" dir="ltr" defaultValue={p && p.nameEn !== p.nameAr ? p.nameEn : ''} className="input" maxLength={80} /></div>
          <div><label className="label" htmlFor="product-description-ar">{t('وصف قصير (اختياري)', 'Short description (optional)')}</label><input id="product-description-ar" name="descriptionAr" defaultValue={p?.descriptionAr ?? ''} className="input" dir="rtl" maxLength={300} placeholder={t('مثلاً: فراخ متبلة + ثومية + بطاطس', 'e.g. marinated chicken, garlic sauce, fries')} /></div>
          <div><label className="label" htmlFor="product-description-en">{t('الوصف بالإنجليزي (اختياري)', 'Description (English, optional)')}</label><input id="product-description-en" name="descriptionEn" dir="ltr" defaultValue={p?.descriptionEn ?? ''} className="input" maxLength={300} /></div>
          <div>
            <label className="label" htmlFor="product-category">{t('القسم', 'Category')}</label>
            <select id="product-category" name="categoryId" defaultValue={p?.categoryId ?? cats[0].id} className="input">
              {cats.map((c) => <option key={c.id} value={c.id}>{localizedName(locale, c.nameAr, c.nameEn)}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="product-price">{t('السعر بالجنيه — لو مفيش أحجام', 'Price (EGP) — used when there are no sizes')}</label><input id="product-price" name="basePrice" defaultValue={p ? p.basePrice / 100 : ''} className="input" inputMode="decimal" required /></div>
          <div className="sm:col-span-2"><ImageField name="imageUrl" restaurantId={restaurantId} initial={p?.imageUrl ?? null} label={t('صورة الصنف', 'Product photo')} /></div>
          <div className="flex flex-wrap items-end gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isAvailable" defaultChecked={p?.isAvailable ?? true} /> {t('متاح دلوقتي', 'Available now')}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} /> {t('ظاهر في المنيو', 'Show on the menu')}</label>
          </div>
          <details className="admin-details admin-form-section sm:col-span-2" open={p?.trackStock || undefined}>
            <summary>{t('الكمية المتاحة (مخزون) — اختياري', 'Stock quantity — optional')}</summary>
            <div className="space-y-3 pt-3">
              <p className="text-xs text-gray-600">{t('فعّلها لو الصنف بيتعمل بكمية محدودة (مثلاً ٣٠ ساندوتش في اليوم). كل طلب بياخد من الكمية، والصنف بيقفل لوحده لما يخلص، والطلب الملغي بيرجّع الكمية.', 'Turn on for items made in limited batches (e.g. 30 sandwiches a day). Every order takes from it, the item closes by itself at zero, and a cancelled order puts it back.')}</p>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="trackStock" defaultChecked={p?.trackStock ?? false} /> {t('تتبّع الكمية للصنف ده', 'Track stock for this product')}</label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">{t('الكمية الموجودة دلوقتي', 'Quantity available now')}</span><input name="stockQty" type="number" min="0" max="100000" inputMode="numeric" defaultValue={p?.stockQty ?? 0} className="input" /></label>
                <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="showStock" defaultChecked={p?.showStock ?? false} /> {t('اعرض الكمية المتبقية للعميل («متبقي ٣»)', 'Show customers what is left (“3 left”)')}</label>
              </div>
              <p className="text-xs text-gray-500">{t('لو مش معروضة للعميل، الكمية بتفضل معلومة ليك انت بس.', 'If not shown, the count stays for your team only.')}</p>
            </div>
          </details>
          <div className="sm:col-span-2">
            <span className="label">{t('الأحجام — اختياري (مثلاً: عادي ٤٥ / كبير ٦٠). لو ضفت أحجام، سعر كل حجم بيحل محل السعر الأساسي.', 'Sizes — optional (e.g. Regular 45 / Large 60). With sizes, each size price replaces the base price.')}</span>
            <RowsEditor
              name="variants"
              addLabel={t('إضافة حجم', 'Add size')}
              columns={[
                { key: 'nameAr', label: t('عربي', 'Arabic'), type: 'text', dir: 'rtl' },
                { key: 'nameEn', label: t('إنجليزي (اختياري)', 'English (opt.)'), type: 'text' },
                { key: 'price', label: t('السعر بالجنيه', 'Price EGP'), type: 'number', width: '100px' },
                ...(canLoad ? [{ key: 'prepLoadUnits', label: t('جهد التحضير — اختياري', 'Load (opt.)'), type: 'number' as const, width: '90px' }] : []),
                { key: 'isAvailable', label: t('متاح', 'On'), type: 'checkbox', width: '40px' },
              ]}
              initial={variants.map((v) => ({ id: v.id, nameAr: v.nameAr, nameEn: v.nameEn, price: String(v.price / 100), prepLoadUnits: v.prepLoadUnits === null ? '' : String(v.prepLoadUnits), isAvailable: v.isAvailable }))}
              blank={{ nameAr: '', nameEn: '', price: '', prepLoadUnits: '', isAvailable: true }}
            />
          </div>
          {groups.length > 0 && (
            <div className="sm:col-span-2">
              <span className="label">{t('الإضافات المتاحة للصنف ده', 'Add-on groups for this product')}</span>
              <div className="flex flex-wrap gap-3">
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="addonGroupIds" value={g.id} defaultChecked={linked.includes(g.id)} /> {localizedName(locale, g.nameAr, g.nameEn)}</label>
                ))}
              </div>
            </div>
          )}
          <details className="admin-details admin-form-section sm:col-span-2">
            <summary>{t('ترتيب الصنف وجهد التحضير — متقدم', 'Display order & preparation effort — advanced')}</summary>
            <div className="grid gap-3 pt-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="product-load">{t('جهد تحضير القطعة', 'Kitchen load units per item')} {canLoad ? '' : t('(بتحددها إدارة المنصة)', '(set by the platform)')}</label>
                <input id="product-load" name="prepLoadUnits" defaultValue={p?.prepLoadUnits ?? 1} className="input" inputMode="numeric" disabled={!canLoad} />
              </div>
              <div><label className="label" htmlFor="product-sort">{t('ترتيب العرض', 'Sort order')}</label><input id="product-sort" name="sortOrder" defaultValue={p?.sortOrder ?? 0} className="input" inputMode="numeric" /></div>
            </div>
          </details>
          <div className="sm:col-span-2"><SubmitButton>{t('حفظ الصنف', 'Save product')}</SubmitButton></div>
        </ActionForm>
      )}
      <p className="text-xs text-gray-500">{t('السعر الجديد يطبق على الطلبات الجديدة فقط. الطلبات السابقة تحتفظ بسعرها.', 'Price changes never affect existing orders — each order stores a snapshot of names and prices.')}</p>
    </div>
  );
}
