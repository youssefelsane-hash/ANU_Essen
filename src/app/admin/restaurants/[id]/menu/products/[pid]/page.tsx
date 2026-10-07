import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';
import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { addonGroups, categories, productAddonGroups, products, productVariants } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { can } from '@/server/auth/authz';
import { saveProductAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { RowsEditor } from '@/components/admin/editors';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function ProductEditPage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { id, pid } = await params;
  const isNew = pid === 'new';
  if (!z.uuid().safeParse(id).success || (!isNew && !z.uuid().safeParse(pid).success)) notFound();
  const auth = await adminPage(`/admin/restaurants/${id}/menu`, 'platform.restaurants');
  if (!auth) return <Forbidden />;
  const [cats, groups] = await Promise.all([
    db().select().from(categories).where(eq(categories.restaurantId, id)).orderBy(asc(categories.sortOrder)),
    db().select().from(addonGroups).where(eq(addonGroups.restaurantId, id)).orderBy(asc(addonGroups.sortOrder)),
  ]);
  const [p] = isNew ? [null] : await db().select().from(products).where(and(eq(products.id, pid), eq(products.restaurantId, id)));
  if (!isNew && !p) notFound();
  const variants = p ? await db().select().from(productVariants).where(eq(productVariants.productId, p.id)).orderBy(asc(productVariants.sortOrder)) : [];
  const linked = p ? (await db().select().from(productAddonGroups).where(eq(productAddonGroups.productId, p.id))).map((l) => l.groupId) : [];
  const canLoad = can(auth, 'platform.queue');

  return (
    <div className="max-w-3xl">
      <Link href={`/admin/restaurants/${id}/menu`} className="text-sm text-blue-700">{t("العودة للمنيو", "← Menu")}</Link>
      <PageTitle title={isNew ? t("إضافة منتج", "New product") : localizedName(locale, p!.nameAr, p!.nameEn)} />
      {cats.length === 0 ? (
        <p className="card">{t("أضف قسمًا أولًا حتى تضع المنتج فيه.", "Create a category first.")}</p>
      ) : (
        <ActionForm action={saveProductAction} className="card grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="restaurantId" value={id} />
          <input type="hidden" name="id" value={p?.id ?? ''} />
          <div><label className="label" htmlFor="product-name-ar">{t("الاسم بالعربي", "Name (Arabic)")}</label><input id="product-name-ar" name="nameAr" defaultValue={p?.nameAr} className="input" dir="rtl" required /></div>
          <div><label className="label" htmlFor="product-name-en">{t("الاسم بالإنجليزي", "Name (English)")}</label><input id="product-name-en" name="nameEn" dir="ltr" defaultValue={p?.nameEn} className="input" required /></div>
          <div><label className="label" htmlFor="product-description-ar">{t("الوصف بالعربي", "Description (Arabic)")}</label><input id="product-description-ar" name="descriptionAr" defaultValue={p?.descriptionAr ?? ''} className="input" dir="rtl" /></div>
          <div><label className="label" htmlFor="product-description-en">{t("الوصف بالإنجليزي", "Description (English)")}</label><input id="product-description-en" name="descriptionEn" dir="ltr" defaultValue={p?.descriptionEn ?? ''} className="input" /></div>
          <div>
            <label className="label" htmlFor="product-category">{t("القسم", "Category")}</label>
            <select id="product-category" name="categoryId" defaultValue={p?.categoryId ?? cats[0].id} className="input">
              {cats.map((c) => <option key={c.id} value={c.id}>{localizedName(locale, c.nameAr, c.nameEn)}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="product-image">{t("رابط صورة المنتج", "Image URL (optimized, https)")}</label><input id="product-image" name="imageUrl" dir="ltr" defaultValue={p?.imageUrl ?? ''} className="input" /></div>
          <div><label className="label" htmlFor="product-price">{t("السعر بالجنيه — عند عدم وجود أحجام", "Base price (EGP) — used when there are no sizes")}</label><input id="product-price" name="basePrice" defaultValue={p ? p.basePrice / 100 : ''} className="input" inputMode="decimal" required /></div>
          <details className="admin-details admin-form-section sm:col-span-2"><summary>{t('ترتيب المنتج وجهد التحضير — متقدم', 'Display order & preparation effort — advanced')}</summary><div className="grid gap-3 pt-3 sm:grid-cols-2">          <div>
            <label className="label" htmlFor="product-load">{t("جهد تحضير القطعة", "Kitchen load units per item")} {canLoad ? '' : t("(لإدارة المنصة فقط)", "(platform admin only)")}</label>
            <input id="product-load" name="prepLoadUnits" defaultValue={p?.prepLoadUnits ?? 1} className="input" inputMode="numeric" disabled={!canLoad} />
          </div>
          <div><label className="label" htmlFor="product-sort">{t("ترتيب العرض", "Sort order")}</label><input id="product-sort" name="sortOrder" defaultValue={p?.sortOrder ?? 0} className="input" inputMode="numeric" /></div>
</div></details>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isAvailable" defaultChecked={p?.isAvailable ?? true} /> {t("متاح", "Available")}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} /> {t("ظاهر في المنيو", "Active (uncheck to archive)")}</label>
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t("الأحجام والأسعار — اختياري", "Sizes / variants (each has its own absolute price; leave empty for none)")}</label>
            <RowsEditor
              name="variants"
              addLabel={t("إضافة حجم", "Add size")}
              columns={[
                { key: 'nameAr', label: t('عربي', 'Arabic'), type: 'text', dir: 'rtl' },
                { key: 'nameEn', label: t('إنجليزي', 'English'), type: 'text' },
                { key: 'price', label: t("السعر بالجنيه", "Price EGP"), type: 'number', width: '100px' },
                { key: 'prepLoadUnits', label: t("جهد التحضير — اختياري", "Load (opt.)"), type: 'number', width: '90px' },
                { key: 'isAvailable', label: t("متاح", "On"), type: 'checkbox', width: '40px' },
              ]}
              initial={variants.map((v) => ({ id: v.id, nameAr: v.nameAr, nameEn: v.nameEn, price: String(v.price / 100), prepLoadUnits: v.prepLoadUnits === null ? '' : String(v.prepLoadUnits), isAvailable: v.isAvailable }))}
              blank={{ nameAr: '', nameEn: '', price: '', prepLoadUnits: '', isAvailable: true }}
            />
          </div>
          {groups.length > 0 && (
            <div className="sm:col-span-2">
              <label className="label">{t("مجموعات الإضافات", "Addon groups")}</label>
              <div className="flex flex-wrap gap-3">
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="addonGroupIds" value={g.id} defaultChecked={linked.includes(g.id)} /> {localizedName(locale, g.nameAr, g.nameEn)}</label>
                ))}
              </div>
            </div>
          )}
          <div className="sm:col-span-2"><SubmitButton>{t("حفظ المنتج", "Save product")}</SubmitButton></div>
        </ActionForm>
      )}
      <p className="mt-3 text-xs text-gray-500">{t("السعر الجديد يطبق على الطلبات الجديدة فقط. الطلبات السابقة تحتفظ بسعرها.", "Price changes never affect existing orders — each order stores a snapshot of names and prices.")}</p>
    </div>
  );
}
