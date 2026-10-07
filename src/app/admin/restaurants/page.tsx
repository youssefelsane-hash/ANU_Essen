import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';
import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { db } from '@/server/db';
import { restaurants } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { createRestaurantAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';
import { RestaurantBrandEditor } from '@/components/admin/restaurant-brand-editor';
import { brandTextColor } from '@/lib/domain/restaurant-brand';

export const dynamic = 'force-dynamic';

export default async function RestaurantsPage() {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/restaurants', 'platform.restaurants'))) return <Forbidden />;
  const list = await db().select().from(restaurants).orderBy(asc(locale === 'ar' ? restaurants.nameAr : restaurants.nameEn));
  return (
    <div className="space-y-6">
      <PageTitle title={t("المطاعم", "Restaurant portfolio")} subtitle={t("كل مطعم له اسمه ومنيوه وفريقه ورمز الطلب الخاص به.", "Independent brands, menus, payments and teams — managed in one place.")} />
      <div className="grid gap-4 xl:grid-cols-2">
        {list.map((r) => (
          <article key={r.id} className="card space-y-5">
            <div className="flex items-start gap-4">
              <div className="grid min-h-16 min-w-16 max-w-24 place-items-center rounded-2xl px-3 py-4 text-center text-sm font-bold" style={{ backgroundColor: r.brandColor, color: brandTextColor(r.brandColor) }} dir="auto">{localizedName(locale, r.badgeText, r.badgeTextEn) || localizedName(locale, r.nameAr, r.nameEn).slice(0, 1)}</div>
              <div className="min-w-0 flex-1"><Link href={`/admin/restaurants/${r.id}`} className="text-lg font-bold text-gray-900">{localizedName(locale, r.nameAr, r.nameEn)}</Link></div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${!r.isActive ? 'bg-red-50 text-red-700' : r.orderingStatus === 'OPEN' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{!r.isActive ? t("موقوف", "Suspended") : r.orderingStatus === 'OPEN' ? t("مفتوح", "Open") : r.orderingStatus === 'PAUSED' ? t("متوقف مؤقتًا", "Paused") : t("مغلق", "Closed")}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 text-sm"><span className="text-gray-500">{t("العمولة", "Commission")} <strong className="text-gray-800">{(r.commissionBps / 100).toFixed(2)}%</strong></span><a href={`/s/${r.slug}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-emerald-700">/s/{r.slug} ↗</a></div>
            <div className="flex flex-wrap gap-2"><Link href={`/admin/restaurants/${r.id}`} className="btn btn-primary btn-sm">{t("إعدادات المطعم", "Manage brand")}</Link><Link href={`/admin/restaurants/${r.id}/menu`} className="btn btn-secondary btn-sm">{t("المنيو", "Menu")}</Link><Link href={`/admin/restaurants/${r.id}/marketing`} className="btn btn-secondary btn-sm">{t("رمز الطلب والملصقات", "QR & posters")}</Link><Link href={`/admin/restaurants/${r.id}/staff`} className="btn btn-secondary btn-sm">{t("الفريق", "Staff")}</Link></div>
            {!r.isActive && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{t("الخدمة موقوفة", "Service suspended")}{r.suspendedReason ? ` — ${r.suspendedReason}` : ''}{t(" — افتح إعدادات المطعم لتشغيل الخدمة.", ". Open “Manage brand” to resume.")}</p>}
          </article>
        ))}
        {!list.length && <div className="card py-10 text-center text-gray-500">{t("ابدأ بإضافة أول مطعم.", "Create your first restaurant below.")}</div>}
      </div>
      <section className="card">
        <h2 className="mb-1 font-bold">{t("إضافة مطعم", "Add a restaurant")}</h2>
        <p className="mb-5 text-sm text-gray-500">{t("أدخل اسم المطعم أولًا، ثم أضف المنيو والفريق.", "Start with its identity. Configure the menu, delivery points and staff after creation.")}</p>
        <ActionForm action={createRestaurantAction} className="max-w-3xl space-y-4">
          <RestaurantBrandEditor />
          <label className="block"><span className="label">{t("اسم رابط المنيو — اختياري", "Public menu slug · optional")}</span><input aria-label={t("اسم رابط المنيو", "Menu link name")} name="slug" placeholder="al-raya" maxLength={48} className="input" dir="ltr" /></label>
          <SubmitButton>{t("إنشاء المطعم", "Create restaurant")}</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-gray-500">{t("يبدأ المطعم بإعدادات الوقت والعمولة الافتراضية. الدفع النقدي متاح؛ أضف حساب إنستا باي قبل تشغيله.", "Created with the default queue config & commission from System settings. Cash is enabled; configure InstaPay before enabling it.")}</p>
      </section>
    </div>
  );
}
