import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';
import { asc, desc, eq } from 'drizzle-orm';
import { normalizeAppUrl } from '@/server/env';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { banners, products, promotions } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant } from '@/server/services/store';
import { deleteBannerAction, saveBannerAction, savePromotionAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { QrGenerator } from '@/components/admin/qr-generator';
import { Forbidden, PageTitle, RestaurantTabs } from '@/components/admin/ui';
import { PROMOTION_TYPES } from '@/lib/domain/pricing';
import { toZonedInputValue } from '@/lib/domain/hours';

export const dynamic = 'force-dynamic';


export default async function MarketingPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (!(await adminPage(`/admin/restaurants/${id}/marketing`, 'platform.restaurants'))) return <Forbidden />;
  const r = await getRestaurant(db(), id);
  if (!r) notFound();
  const [bannerRows, promoRows, productRows] = await Promise.all([
    db().select().from(banners).where(eq(banners.restaurantId, id)).orderBy(asc(banners.sortOrder)),
    db().select().from(promotions).where(eq(promotions.restaurantId, id)).orderBy(desc(promotions.createdAt)),
    db().select({ id: products.id, nameEn: locale === 'ar' ? products.nameAr : products.nameEn }).from(products).where(eq(products.restaurantId, id)),
  ]);

  return (
    <div>
      <PageTitle title={`${localizedName(locale, r.nameAr, r.nameEn)} — ${t("رمز الطلب والعروض", "QR & offers")}`} />
      <RestaurantTabs id={id} active="marketing" />
      <div className="space-y-6">
        <section className="card">
          <h2 className="mb-3 font-bold">{t("رمز الطلب والملصق", "QR code for posters")}</h2>
          <QrGenerator restaurant={r} baseUrl={normalizeAppUrl(process.env.APP_URL) ?? null} />
        </section>

        <section className="card">
          <h2 className="mb-3 font-bold">{t("إعلانات المنيو — المواعيد حسب", "Promotional banners (shown on the menu) — times in")} {r.timezone}</h2>
          <div className="space-y-3">
            {[...bannerRows, null].map((b, i) => (
              <div key={b?.id ?? `new-${i}`} className="rounded-xl bg-gray-50 p-3">
                <ActionForm action={saveBannerAction} className="grid gap-2 md:grid-cols-4">
                  <input type="hidden" name="restaurantId" value={id} />
                  <input type="hidden" name="id" value={b?.id ?? ''} />
                  <input aria-label={t("عنوان الإعلان بالعربي", "Banner title in Arabic")} name="titleAr" defaultValue={b?.titleAr ?? ''} placeholder={t("العنوان بالعربي", "Title in Arabic")} className="input md:col-span-2" dir="rtl" required />
                  <input aria-label={t("نص الإعلان بالعربي", "Banner subtitle in Arabic")} name="subtitleAr" defaultValue={b?.subtitleAr ?? ''} placeholder={t("نص إضافي بالعربي", "Subtitle in Arabic")} className="input md:col-span-2" dir="rtl" />
                  <details className="admin-details md:col-span-4"><summary>{t('النص بالإنجليزي — اختياري', 'English translation — optional')}</summary><div className="grid gap-2 py-3 sm:grid-cols-2"><label><span className="label">{t('العنوان بالإنجليزي', 'Title in English')}</span><input aria-label={t("عنوان الإعلان بالإنجليزي", "Banner title in English")} name="titleEn" defaultValue={b?.titleEn ?? ''} maxLength={120} className="input" dir="ltr" /></label><label><span className="label">{t('النص الإضافي بالإنجليزي', 'Subtitle in English')}</span><input aria-label={t("نص الإعلان بالإنجليزي", "Banner subtitle in English")} name="subtitleEn" defaultValue={b?.subtitleEn ?? ''} className="input" dir="ltr" /></label></div></details>
                  <input aria-label={t("رابط الصورة", "Image link")} name="imageUrl" defaultValue={b?.imageUrl ?? ''} placeholder={t("رابط الصورة — اختياري", "Image URL (optional)")} className="input md:col-span-2" />
                  <label className="text-xs">{t("لون الخلفية", "Background")} <input type="color" name="bgColor" defaultValue={b?.bgColor ?? '#c2410c'} className="h-9 w-full" /></label>
                  <label className="text-xs">{t("لون الكتابة", "Text")} <input type="color" name="textColor" defaultValue={b?.textColor ?? '#ffffff'} className="h-9 w-full" /></label>
                  <label className="text-xs">{t("يبدأ", "Starts")} <input type="datetime-local" name="startsAt" defaultValue={toZonedInputValue(b?.startsAt, r.timezone)} className="input py-1" /></label>
                  <label className="text-xs">{t("ينتهي", "Ends")} <input type="datetime-local" name="endsAt" defaultValue={toZonedInputValue(b?.endsAt, r.timezone)} className="input py-1" /></label>
                  <label className="text-xs">{t("ترتيب العرض", "Sort")} <input aria-label={t("ترتيب العرض", "Display order")} name="sortOrder" defaultValue={b?.sortOrder ?? bannerRows.length + 1} className="input py-1" /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={b?.isActive ?? true} /> {t("نشط", "Active")}</label>
                  <div className="md:col-span-4"><SubmitButton className="btn btn-secondary btn-sm">{b ? t("حفظ الإعلان", "Save banner") : t("إضافة إعلان", "Add banner")}</SubmitButton></div>
                </ActionForm>
                {b && (
                  <form action={deleteBannerAction.bind(null, id, b.id)} className="mt-1">
                    <button className="btn btn-ghost btn-sm text-red-600">{t("حذف الإعلان", "Delete banner")}</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="mb-1 font-bold">{t("الخصومات", "Promotions")}</h2>
          <p className="mb-3 text-xs text-gray-500">{t("اختر نسبة خصم أو مبلغًا بالجنيه. أضف كودًا ليستخدمه العميل أو فعّل تطبيق الخصم تلقائيًا. يُطبق أفضل خصم واحد على الطلب.", "Percent types: value in %. Fixed types: value in EGP. A promotion with a code applies only when the customer enters it; without a code, tick “auto-apply”. One promotion per order (the best one).")}</p>
          <div className="space-y-3">
            {[...promoRows, null].map((p, i) => {
              const isPct = p?.type === 'PERCENT' || p?.type === 'PRODUCT_PERCENT';
              return (
                <ActionForm key={p?.id ?? `new-${i}`} action={savePromotionAction} className="grid gap-2 rounded-xl bg-gray-50 p-3 md:grid-cols-4">
                  <input type="hidden" name="restaurantId" value={id} />
                  <input type="hidden" name="id" value={p?.id ?? ''} />
                  <input aria-label={t("الاسم", "Name")} name="name" defaultValue={p?.name ?? ''} placeholder={t("اسم الخصم للفريق", "Internal name")} className="input" required />
                  <select aria-label={t("نوع الخصم", "Offer type")} name="type" defaultValue={p?.type ?? 'PERCENT'} className="input">
                    {PROMOTION_TYPES.map((type) => <option key={type} value={type}>{{ PERCENT: t('نسبة من الطلب', 'Order percentage'), FIXED: t('مبلغ من الطلب', 'Fixed order discount'), PRODUCT_PERCENT: t('نسبة من منتج', 'Product percentage'), PRODUCT_FIXED: t('مبلغ من منتج', 'Fixed product discount'), BANNER_ONLY: t('عرض إعلاني فقط', 'Banner only') }[type]}</option>)}
                  </select>
                  <input aria-label={t("قيمة الخصم", "Discount value")} name="value" defaultValue={p ? (isPct ? p.value / 100 : p.value / 100) : ''} placeholder={t("القيمة — نسبة أو جنيه", "Value (% or EGP)")} className="input" />
                  <input aria-label={t("كود الخصم", "Offer code")} name="code" defaultValue={p?.code ?? ''} placeholder={t("كود الخصم — اختياري", "CODE (optional)")} className="input uppercase" />
                  <select aria-label={t("المنتج", "Product")} name="productId" defaultValue={p?.productId ?? ''} className="input">
                    <option value="">{t("اختر المنتج لخصم المنتج", "— product (for PRODUCT_*) —")}</option>
                    {productRows.map((x) => <option key={x.id} value={x.id}>{x.nameEn}</option>)}
                  </select>
                  <input aria-label={t("الحد الأدنى للطلب", "Minimum order")} name="minSubtotal" defaultValue={p ? p.minSubtotal / 100 : ''} placeholder={t("الحد الأدنى للطلب بالجنيه", "Min order EGP")} className="input" />
                  <input aria-label={t("أقصى خصم", "Maximum discount")} name="maxDiscount" defaultValue={p?.maxDiscount != null ? p.maxDiscount / 100 : ''} placeholder={t("أقصى خصم بالجنيه", "Max discount EGP")} className="input" />
                  <input aria-label={t("أقصى مرات استخدام", "Usage limit")} name="usageLimit" defaultValue={p?.usageLimit ?? ''} placeholder={t("أقصى عدد مرات استخدام", "Usage limit")} className="input" />
                  <label className="text-xs">{t("يبدأ", "Starts")} <input type="datetime-local" name="startsAt" defaultValue={toZonedInputValue(p?.startsAt, r.timezone)} className="input py-1" /></label>
                  <label className="text-xs">{t("ينتهي", "Ends")} <input type="datetime-local" name="endsAt" defaultValue={toZonedInputValue(p?.endsAt, r.timezone)} className="input py-1" /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoApply" defaultChecked={p?.autoApply ?? false} /> {t("يُطبق تلقائيًا", "Auto-apply")}</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} /> {t("نشط", "Active")}</label>
                  <div className="flex items-center gap-3 md:col-span-4">
                    <SubmitButton className="btn btn-secondary btn-sm">{p ? t("حفظ", "Save") : t("إضافة خصم", "Add promotion")}</SubmitButton>
                    {p && <span className="text-xs text-gray-500">{t("استُخدم", "Used")} {p.usedCount}{p.usageLimit ? ` / ${p.usageLimit}` : ''} {t("مرة", "times")}</span>}
                  </div>
                </ActionForm>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
