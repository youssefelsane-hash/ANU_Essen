import { getLocale } from '@/lib/i18n/server';
import { text, roleLabel } from '@/lib/i18n';
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { restaurants, roles, userRoles, users } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { assignRoleAction, removeRoleAction, resetPasswordAction, setUserActiveAction } from '@/server/actions/admin-platform';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await adminPage(`/admin/users/${id}`, 'platform.users');
  if (!auth) return <Forbidden />;
  const [u] = await db().select().from(users).where(eq(users.id, id));
  if (!u) notFound();
  const [assignments, roleList, restaurantList] = await Promise.all([
    db()
      .select({ id: userRoles.id, role: roles.name, roleKey: roles.key, scope: roles.scope, restaurant: locale === 'ar' ? restaurants.nameAr : restaurants.nameEn })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(restaurants, eq(restaurants.id, userRoles.restaurantId))
      .where(eq(userRoles.userId, id)),
    db().select().from(roles).orderBy(asc(roles.scope), asc(roles.name)),
    db().select({ id: restaurants.id, nameEn: locale === 'ar' ? restaurants.nameAr : restaurants.nameEn }).from(restaurants).orderBy(asc(locale === 'ar' ? restaurants.nameAr : restaurants.nameEn)),
  ]);
  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/admin/users" className="text-sm text-blue-700">{t("العودة للمستخدمين", "← Users")}</Link>
      <PageTitle title={u.name} subtitle={u.email}>
        {u.id !== auth.user.id && (
          <form action={setUserActiveAction.bind(null, u.id, !u.isActive)}>
            <button className={`btn btn-sm ${u.isActive ? 'btn-danger' : 'btn-success'}`}>{u.isActive ? t("حظر المستخدم", "Disable user") : t("إلغاء الحظر", "Enable user")}</button>
          </form>
        )}
      </PageTitle>
      <section className="card">
        <h2 className="mb-2 font-bold">{t("الأدوار", "Roles")}</h2>
        <table className="table">
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td>{roleLabel(a.roleKey, locale, a.role)}</td>
                <td>{a.scope === 'PLATFORM' ? t("كل المنصة", "Platform-wide") : a.restaurant}</td>
                <td><form action={removeRoleAction.bind(null, a.id)}><button className="btn btn-ghost btn-sm text-red-600">{t("حذف", "Remove")}</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionForm action={assignRoleAction} className="mt-3 grid gap-2 sm:grid-cols-3">
          <input type="hidden" name="userId" value={u.id} />
          <select aria-label={t("الدور", "Role")} name="roleKey" className="input">
            {roleList.map((r) => <option key={r.id} value={r.key}>{roleLabel(r.key, locale, r.name)} ({r.scope === 'STORE' ? t('مطعم', 'Restaurant') : t('منصة', 'Platform')})</option>)}
          </select>
          <select aria-label={t("المطعم", "Restaurant")} name="restaurantId" className="input">
            <option value="">{t("اختر مطعمًا لدور المطعم", "— restaurant (store roles) —")}</option>
            {restaurantList.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
          </select>
          <SubmitButton className="btn btn-secondary">{t("إضافة الدور", "Assign role")}</SubmitButton>
        </ActionForm>
      </section>
      <section className="card">
        <h2 className="mb-2 font-bold">{t("تغيير كلمة المرور", "Reset password")}</h2>
        <ActionForm action={resetPasswordAction} resetOnSuccess className="flex gap-2">
          <input type="hidden" name="userId" value={u.id} />
          <input aria-label={t("كلمة المرور", "Password")} name="password" type="password" placeholder={t("كلمة المرور الجديدة", "New password")} className="input max-w-xs" autoComplete="new-password" required />
          <SubmitButton className="btn btn-secondary">{t("تغيير", "Reset")}</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
