import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';
import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { formatDateTime } from '@/lib/domain/misc';
import { db } from '@/server/db';
import { deliveryPoints, restaurantPaymentMethods } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant } from '@/server/services/store';
import { resumeRestaurantAction, saveDeliveryPointAction, suspendRestaurantAction, updatePaymentMethodAction, updateRestaurantAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { HoursEditor } from '@/components/admin/editors';
import { PlatformRateField } from '@/components/admin/platform-rate-field';
import { RestaurantBrandEditor } from '@/components/admin/restaurant-brand-editor';
import { Forbidden, PageTitle, RestaurantTabs } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

export default async function RestaurantSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (!(await adminPage(`/admin/restaurants/${id}`, 'platform.restaurants'))) return <Forbidden />;
  const r = await getRestaurant(db(), id);
  if (!r) notFound();
  const [methods, points] = await Promise.all([
    db().select().from(restaurantPaymentMethods).where(eq(restaurantPaymentMethods.restaurantId, id)),
    db().select().from(deliveryPoints).where(eq(deliveryPoints.restaurantId, id)).orderBy(asc(deliveryPoints.sortOrder)),
  ]);
  const instapay = methods.find((m) => m.method === 'INSTAPAY');
  const cash = methods.find((m) => m.method === 'CASH');

  return (
    <div>
      <PageTitle title={localizedName(locale, r.nameAr, r.nameEn)}>
        <a href={`/s/${r.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">{t("فتح منيو العميل ↗", "Open customer menu ↗")}</a>
      </PageTitle>
      <RestaurantTabs id={id} active="settings" />
      <ServiceStatus restaurant={r} />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card">
          <h2 className="mb-1 font-bold">{t("بيانات المطعم", "Restaurant identity & operations")}</h2>
          <p className="mb-5 text-sm text-gray-500">{t("عدّل الاسم والشارة والصور واللون. المعاينة تتحدث أثناء الكتابة.", "Give each restaurant its own name, badge, photos and color. The preview updates as you edit.")}</p>
          <ActionForm action={updateRestaurantAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={r.id} />
            <div className="mb-3 sm:col-span-2"><RestaurantBrandEditor initial={r} /></div>
            <Field label={t("رقم التواصل الظاهر للعميل", "Phone (shown to customers)")}><input name="phone" defaultValue={r.phone ?? ''} className="input" /></Field>
            <Field label={t("استقبال الطلبات", "Ordering status")}>
              <select name="orderingStatus" defaultValue={r.orderingStatus} className="input">
                <option value="OPEN">{t("مفتوح", "Open")}</option>
                <option value="PAUSED">{t("متوقف مؤقتًا", "Paused")}</option>
                <option value="CLOSED">{t("مغلق", "Closed")}</option>
              </select>
            </Field>
            <Field label={t("الحد الأدنى للطلب بالجنيه", "Minimum order (EGP)")}><input name="minOrder" defaultValue={r.minOrderAmount / 100} className="input" inputMode="decimal" /></Field>
            <details className="admin-details admin-form-section sm:col-span-2"><summary>{t('مواعيد العمل', 'Opening hours')}</summary><div className="pt-3">            <div className="sm:col-span-2">
              <label className="label">{t("مواعيد العمل (", "Opening hours (")}{r.timezone})</label>
              <HoursEditor name="openingHours" initial={r.openingHours ?? null} />
            </div>
</div></details>
            <PlatformRateField basisPoints={r.commissionBps} serviceFee={r.serviceFee} deliveryFee={r.platformDeliveryFee} deliveryPayer={r.platformDeliveryPayer} />
            <details className="admin-details admin-form-section sm:col-span-2"><summary>{t('إعدادات إضافية', 'Other settings')}</summary><div className="grid gap-3 pt-3 sm:grid-cols-2">            <Field label={t("اسم رابط المنيو", "URL slug (/s/…)")}><input aria-label={t("اسم رابط المنيو", "Menu link name")} name="slug" dir="ltr" defaultValue={r.slug} maxLength={48} className="input" required /><p className="mt-1 text-[11px] text-gray-500">{t("تغيير الاسم هنا يغيّر الرابط المباشر؛ رمز الطلب المطبوع يظل يعمل.", "Changing this updates direct menu links. Permanent QR links keep working.")}</p></Field>

            <Field label={t("المنطقة الزمنية", "Timezone")}><input aria-label={t("المنطقة الزمنية", "Timezone")} name="timezone" dir="ltr" defaultValue={r.timezone} className="input" /></Field>


            <Field label={t("إلغاء الطلب غير المدفوع بعد — بالدقائق، صفر للإيقاف", "Cancel unpaid InstaPay orders after (min, 0 = never)")}><input name="unpaidTimeoutMinutes" defaultValue={r.unpaidTimeoutMinutes} className="input" inputMode="numeric" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requirePhone" defaultChecked={r.requirePhone} /> {t("رقم الهاتف مطلوب للطلب", "Phone number required at checkout")}</label>
</div></details>
            <div className="sm:col-span-2"><SubmitButton>{t("حفظ بيانات المطعم", "Save settings")}</SubmitButton></div>
          </ActionForm>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">{t("رمز الطلب لا يتغير مع اسم المطعم. العمولة الجديدة تطبق على الطلبات الجديدة فقط.", "Your QR poster uses a permanent restaurant link, so renaming or changing the slug keeps printed codes working. Commission changes apply to new orders; each order keeps its original rate.")}</p>
        </section>

        <div className="space-y-6">
          <section className="card">
            <h2 className="mb-3 font-bold">{t("إنستا باي", "InstaPay")}</h2>
            <ActionForm action={updatePaymentMethodAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="restaurantId" value={r.id} />
              <input type="hidden" name="method" value="INSTAPAY" />
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="isEnabled" defaultChecked={instapay?.isEnabled ?? false} /> {t("تشغيل إنستا باي", "InstaPay enabled")}</label>
              <Field label={t("اسم صاحب الحساب", "Account name")}><input name="accountName" defaultValue={instapay?.config.accountName ?? ''} className="input" /></Field>
              <Field label={t("عنوان إنستا باي (name@instapay)", "InstaPay address (name@instapay)")}><input name="address" defaultValue={instapay?.config.address ?? ''} className="input" /></Field>
              <details className="admin-details sm:col-span-2"><summary>{t('رقم الهاتف وتعليمات الدفع — اختياري', 'Phone & payment instructions — optional')}</summary><div className="grid gap-3 pt-3 sm:grid-cols-2">              <Field label={t("رقم الموبايل", "Mobile number")}><input name="phone" defaultValue={instapay?.config.phone ?? ''} className="input" /></Field>
              <Field label={t("رابط الدفع — اختياري", "Payment link (optional)")}><input name="link" defaultValue={instapay?.config.link ?? ''} className="input" /></Field>
              <div className="sm:col-span-2"><Field label={t("تعليمات الدفع بالعربي", "Instructions for the customer (Arabic)")}><input name="instructions" defaultValue={instapay?.config.instructions ?? ''} className="input" dir="rtl" /></Field></div>
              <div className="sm:col-span-2"><Field label={t('تعليمات الدفع بالإنجليزي — اختياري', 'Payment instructions in English — optional')}><input name="instructionsEn" defaultValue={instapay?.config.instructionsEn ?? ''} className="input" dir="ltr" /></Field></div>
</div></details>
              <div className="sm:col-span-2"><SubmitButton>{t("حفظ حساب إنستا باي", "Save InstaPay")}</SubmitButton></div>
            </ActionForm>
            <p className="mt-2 text-xs text-gray-500">{t("يُراجع فريق المطعم التحويل ويؤكد استلامه من شاشة الطلبات.", "The restaurant team checks the incoming transfer and confirms payment on the orders screen.")}</p>
          </section>
          <section className="card">
            <h2 className="mb-3 font-bold">{t("الدفع عند الاستلام", "Cash on delivery")}</h2>
            <ActionForm action={updatePaymentMethodAction} className="flex items-center justify-between gap-3">
              <input type="hidden" name="restaurantId" value={r.id} />
              <input type="hidden" name="method" value="CASH" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isEnabled" defaultChecked={cash?.isEnabled ?? false} /> {t("تشغيل الدفع النقدي", "Cash enabled")}</label>
              <SubmitButton className="btn btn-secondary btn-sm">{t("حفظ", "Save")}</SubmitButton>
            </ActionForm>
          </section>
          <section className="card">
            <h2 className="mb-3 font-bold">{t("أماكن الاستلام", "Delivery points")}</h2>
            <div className="space-y-4">
              {[...points, null].map((p, i) => (
                <ActionForm key={p?.id ?? `new-${i}`} action={saveDeliveryPointAction} className="grid gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-2">
                  <input type="hidden" name="restaurantId" value={r.id} />
                  <input type="hidden" name="id" value={p?.id ?? ''} />
                  <div className="text-xs font-semibold text-gray-500 sm:col-span-2">{p ? t("مكان الاستلام", "Delivery point") : t("إضافة مكان استلام", "Add delivery point")}</div>
                  <input aria-label={t("اسم مكان الاستلام بالعربي", "Pickup name in Arabic")} name="nameAr" defaultValue={p?.nameAr ?? ''} placeholder={t("الاسم بالعربي", "Name (Arabic)")} className="input" dir="rtl" required />
                  <input aria-label={t("اسم مكان الاستلام بالإنجليزي", "Pickup name in English")} name="nameEn" defaultValue={p?.nameEn ?? ''} placeholder={t("الاسم بالإنجليزي", "Name (English)")} className="input" required />
                  <Field label={t("النوع", "Type")}>
                    <select name="kind" defaultValue={p?.kind ?? 'DELIVERY'} className="input">
                      <option value="DELIVERY">{t("🛵 توصيل لنقطة استلام (مثلاً بوابة الجامعة)", "🛵 Delivery to a pickup point (e.g. university gate)")}</option>
                      <option value="PICKUP">{t("🏪 استلام من المطعم (من غير توصيل)", "🏪 Pickup at the restaurant (no delivery)")}</option>
                    </select>
                  </Field>
                  <div className="hidden sm:block" />
                  <Field label={t("رسوم التوصيل بالجنيه", "Delivery fee (EGP)")}><input name="deliveryFee" defaultValue={(p?.deliveryFee ?? 0) / 100} className="input" /></Field>
                  <Field label={t("وقت توصيل إضافي بالدقائق", "Extra delivery minutes")}><input name="extraMinutes" defaultValue={p?.extraMinutes ?? 0} className="input" /></Field>
                  <input type="hidden" name="sortOrder" value={p?.sortOrder ?? points.length} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={p?.isDefault ?? points.length === 0} /> {t("افتراضي", "Default")}</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} /> {t("نشط", "Active")}</label>
                  <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary btn-sm">{p ? t("حفظ", "Save") : t("إضافة", "Add")}</SubmitButton></div>
                </ActionForm>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

async function ServiceStatus({ restaurant: r }: { restaurant: { id: string; isActive: boolean; suspendedReason: string | null; suspendedAt: Date | null; timezone: string } }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!r.isActive) {
    return (
      <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-red-300 bg-red-50 p-4">
        <div>
          <h2 className="font-bold text-red-800">{t("الخدمة موقوفة", "Service suspended")}</h2>
          <p className="text-sm text-red-700">
            {t("استقبال الطلبات الجديدة متوقف. يمكن للفريق إنهاء الطلبات الموجودة بالفعل.", "Customers can't order and the restaurant can't reopen. Orders already in progress can still be finished.")}
            {r.suspendedReason && <> {t("السبب:", "Reason:")} <b>{r.suspendedReason}</b></>}
            {r.suspendedAt && <> {t("· منذ", "· since")} {formatDateTime(r.suspendedAt, r.timezone, locale)}</>}
          </p>
        </div>
        <form action={resumeRestaurantAction.bind(null, r.id)}>
          <button className="btn btn-success">{t("تشغيل الخدمة", "Resume service")}</button>
        </form>
      </section>
    );
  }
  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          <span className="me-2 inline-block size-2 rounded-full bg-emerald-500" />{t("الخدمة تعمل — إيقاف الخدمة…", "Service active · Suspend this restaurant…")}
        </summary>
        <ActionForm action={suspendRestaurantAction} className="mt-3 flex flex-wrap items-end gap-2" confirm={t("إيقاف خدمة المطعم؟ لن يستقبل طلبات جديدة حتى تُشغله مرة أخرى.", "Suspend this restaurant? Customers will not be able to order until you resume it.")}>
          <input type="hidden" name="restaurantId" value={r.id} />
          <label className="min-w-64 flex-1">
            <span className="label">{t("سبب الإيقاف — يظهر لفريق المطعم", "Reason (shown on the restaurant's screen)")}</span>
            <input name="reason" required minLength={3} maxLength={200} className="input" placeholder={t("مثال: عمولة لم يتم سدادها", "e.g. commission overdue / contract paused")} />
          </label>
          <SubmitButton className="btn btn-danger">{t("إيقاف الخدمة", "Suspend service")}</SubmitButton>
        </ActionForm>
      </details>
    </section>
  );
}
