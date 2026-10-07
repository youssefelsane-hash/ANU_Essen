import { getLocale } from '@/lib/i18n/server';
import { text, roleLabel } from '@/lib/i18n';
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { restaurants, roles, userRoles, users } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { createUserAction, setUserActiveAction } from '@/server/actions/admin-platform';
import { pageAuth } from '@/server/auth/session';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/users', 'platform.users'))) return <Forbidden />;
  const me = await pageAuth('/admin/users');
  const [list, assignments, roleList, restaurantList] = await Promise.all([
    db().select().from(users).orderBy(asc(users.name)),
    db()
      .select({ userId: userRoles.userId, role: roles.name, roleKey: roles.key, restaurant: locale === 'ar' ? restaurants.nameAr : restaurants.nameEn })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(restaurants, eq(restaurants.id, userRoles.restaurantId)),
    db().select().from(roles).orderBy(asc(roles.scope), asc(roles.name)),
    db().select({ id: restaurants.id, nameEn: locale === 'ar' ? restaurants.nameAr : restaurants.nameEn }).from(restaurants).orderBy(asc(locale === 'ar' ? restaurants.nameAr : restaurants.nameEn)),
  ]);
  return (
    <div className="space-y-6">
      <PageTitle title={t("المستخدمون والفريق", "Users & staff")} />
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>{t("الاسم", "Name")}</th><th>{t("البريد المستخدم للدخول", "Email (sign-in)")}</th><th>{t("الأدوار", "Roles")}</th><th>{t("الحالة", "Status")}</th><th /></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td><Link className="font-semibold text-blue-700" href={`/admin/users/${u.id}`}>{u.name}</Link></td>
                <td>{u.email}</td>
                <td className="text-xs">{assignments.filter((a) => a.userId === u.id).map((a) => `${roleLabel(a.roleKey, locale, a.role)}${a.restaurant ? ` @ ${a.restaurant}` : ''}`).join(', ') || '—'}</td>
                <td>{u.isActive ? <span className="badge bg-emerald-50 text-emerald-700">{t("نشط", "Active")}</span> : <span className="badge bg-red-100 text-red-700">{t("محظور", "Blocked")}</span>}</td>
                <td>
                  {u.id !== me.user.id && (
                    <form action={setUserActiveAction.bind(null, u.id, !u.isActive)}>
                      <button className={`btn btn-sm ${u.isActive ? 'btn-danger' : 'btn-success'}`}>{u.isActive ? t("حظر", "Block") : t("إلغاء الحظر", "Unblock")}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2 className="mb-3 font-bold">{t("إضافة مستخدم", "Create user")}</h2>
        <ActionForm action={createUserAction} resetOnSuccess className="grid gap-2 md:grid-cols-3">
          <input aria-label={t("الاسم", "Name")} name="name" placeholder={t("الاسم", "Name")} className="input" required />
          <input aria-label={t("البريد الإلكتروني", "Email")} name="email" type="email" placeholder={t("البريد الإلكتروني", "Email")} className="input" required />
          <input aria-label={t("كلمة المرور", "Password")} name="password" type="password" placeholder={t("كلمة المرور — 8 أحرف على الأقل", "Password (min 8)")} className="input" autoComplete="new-password" required />
          <select aria-label={t("الدور", "Role")} name="roleKey" className="input">
            <option value="">{t("بدون دور", "— no role —")}</option>
            {roleList.map((r) => <option key={r.id} value={r.key}>{roleLabel(r.key, locale, r.name)} ({r.scope === 'STORE' ? t('مطعم', 'Restaurant') : t('منصة', 'Platform')})</option>)}
          </select>
          <select aria-label={t("المطعم", "Restaurant")} name="restaurantId" className="input">
            <option value="">{t("اختر مطعمًا لدور المطعم", "— restaurant (store roles) —")}</option>
            {restaurantList.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
          </select>
          <SubmitButton>{t("إنشاء", "Create")}</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
