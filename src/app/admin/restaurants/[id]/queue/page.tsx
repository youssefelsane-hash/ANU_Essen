import { getLocale } from '@/lib/i18n/server';
import { text, localizedName, labels } from '@/lib/i18n';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant, getStoreLive } from '@/server/services/store';
import { updateQueueConfigAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { QueueEditor } from '@/components/admin/editors';
import { Forbidden, PageTitle, RestaurantTabs, Stat } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function QueuePage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (!(await adminPage(`/admin/restaurants/${id}/queue`, 'platform.queue'))) return <Forbidden />;
  const r = await getRestaurant(db(), id);
  if (!r) notFound();
  const live = await getStoreLive(db(), r);
  return (
    <div>
      <PageTitle title={`${localizedName(locale, r.nameAr, r.nameEn)} — ${t("وقت التحضير", "Preparation time")}`} subtitle={t("أدخل الوقت الأساسي، ثم عدّل إعدادات الزحمة عند الحاجة. الفريق يرى الوقت الناتج فقط.", "Only platform admins can change these values; merchants only see the result.")} />
      <RestaurantTabs id={id} active="queue" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("جهد الطلبات الحالية", "Active kitchen load (units)")} value={live.load} />
        <Stat label={t("طلبات في المطبخ", "Orders in kitchen")} value={live.activeOrders} />
        <Stat label={t("ضغط المطبخ", "Level")} value={labels(locale).loadLevel[live.level]} />
        <Stat label={t("وقت الطلب الجديد", "ETA for a new order")} value={`${live.etaMinutes} ${t("دقيقة", "min")}`} hint={labels(locale).storeStatus[live.status]} />
      </div>
      <section className="card">
        <ActionForm action={updateQueueConfigAction} className="space-y-4">
          <input type="hidden" name="restaurantId" value={id} />
          <QueueEditor initial={live.config} />
          <SubmitButton>{t("حفظ إعدادات الوقت", "Save queue configuration")}</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
