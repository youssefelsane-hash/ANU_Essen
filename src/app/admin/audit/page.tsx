import { getLocale } from '@/lib/i18n/server';
import { text, labels } from '@/lib/i18n';
import { and, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { auditLogs, restaurants } from '@/server/db/schema';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { Forbidden, PageTitle, Pagination } from '@/components/admin/ui';
import { activityLabel, entityLabel, actorTypeLabel, matchingActivityCodes } from '@/components/admin/activity-labels';
import { formatDateTime } from '@/lib/domain/misc';

export const dynamic = 'force-dynamic';
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; restaurant?: string; page?: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/audit', 'platform.audit'))) return <Forbidden />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const tz = await platformTimezone();
  const where: SQL[] = [];
  if (sp.action) {
    const query = sp.action.trim().slice(0, 40);
    const matchingCodes = matchingActivityCodes(query);
    where.push(matchingCodes.length ? or(ilike(auditLogs.action, `%${query}%`), inArray(auditLogs.action, matchingCodes))! : ilike(auditLogs.action, `%${query}%`));
  }
  if (sp.restaurant) where.push(eq(auditLogs.restaurantId, sp.restaurant));
  const [rows, restaurantList] = await Promise.all([
    db()
      .select({ a: auditLogs, restaurant: locale === 'ar' ? restaurants.nameAr : restaurants.nameEn })
      .from(auditLogs)
      .leftJoin(restaurants, eq(restaurants.id, auditLogs.restaurantId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(PAGE + 1)
      .offset((page - 1) * PAGE),
    db().select({ id: restaurants.id, nameEn: locale === 'ar' ? restaurants.nameAr : restaurants.nameEn }).from(restaurants),
  ]);
  const qs = new URLSearchParams(Object.entries({ action: sp.action ?? '', restaurant: sp.restaurant ?? '' }).filter(([, v]) => v)).toString();
  return (
    <div>
      <PageTitle title={t("سجل النشاط", "Audit log")} subtitle={t("راجع التغييرات ومن قام بها ووقتها.", "Who changed what, when — prices, payments, cancellations, commissions, queue settings, staff.")} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input aria-label={t("النشاط", "Activity")} name="action" defaultValue={sp.action ?? ''} placeholder={t("ابحث باسم النشاط…", "action contains… (e.g. price, verify, commission)")} className="input max-w-sm" />
        <select aria-label={t("المطعم", "Restaurant")} name="restaurant" defaultValue={sp.restaurant ?? ''} className="input max-w-xs">
          <option value="">{t("كل المطاعم", "All restaurants")}</option>
          {restaurantList.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
        </select>
        <button className="btn btn-secondary">{t("عرض النتائج", "Filter")}</button>
      </form>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>{t("الوقت", "When")}</th><th>{t("بواسطة", "Actor")}</th><th>{t("النشاط", "Action")}</th><th>{t("العنصر", "Entity")}</th><th>{t("المطعم", "Restaurant")}</th><th>{t("التغيير", "Change")}</th><th>{t("عنوان الاتصال / الجهاز", "IP / device")}</th></tr></thead>
          <tbody>
            {rows.slice(0, PAGE).map(({ a, restaurant }) => (
              <tr key={a.id}>
                <td className="text-xs whitespace-nowrap text-gray-500">{formatDateTime(a.createdAt, tz, locale)}</td>
                <td className="text-sm">{a.actorType === 'SYSTEM' && a.actorLabel === 'payment-timeout' ? t('انتهاء مهلة الدفع', 'Payment timeout') : a.actorLabel ?? actorTypeLabel(a.actorType, locale)}<div className="text-xs text-gray-400">{actorTypeLabel(a.actorType, locale)}</div></td>
                <td><span className="text-sm">{activityLabel(a.action, locale)}</span></td>
                <td className="text-xs">{entityLabel(a.entity, locale)}<div className="font-mono text-[10px] text-gray-400">{a.entityId?.slice(0, 8)}</div></td>
                <td className="text-xs">{restaurant ?? '—'}</td>
                <td className="max-w-md">
                  <details>
                    <summary className="cursor-pointer text-xs text-blue-700">{t("عرض التفاصيل", "view")}</summary>
                    <pre className="mt-1 max-h-60 overflow-auto rounded bg-gray-50 p-2 text-[11px]">{JSON.stringify({ [t("قبل", "Before")]: a.before, [t("بعد", "After")]: a.after, [t("رمز النشاط", "Activity code")]: a.action }, null, 2)}</pre>
                  </details>
                </td>
                <td className="text-[11px] text-gray-500">{a.ip}{a.deviceId ? ` · ${a.deviceId.slice(0, 8)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} hasMore={rows.length > PAGE} base={`/admin/audit${qs ? `?${qs}` : ''}`} />
      </section>
    </div>
  );
}
