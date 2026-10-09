import { getLocale } from '@/lib/i18n/server';
import { text, roleLabel } from '@/lib/i18n';
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { restaurants, roles, userRoles, users } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { setUserActiveAction } from '@/server/actions/admin-platform';
import { ALL_PERMISSIONS } from '@/lib/domain/permissions';
import { pageAuth } from '@/server/auth/session';
import { CreateUserForm } from '@/components/admin/create-user-form';
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
      <PageTitle title={t("المستخدمون والفريق", "Users & staff")} subtitle={t("كل الحسابات اللي بتدخل السيستم. «حظر» بيطلّع الشخص فورًا من كل الأجهزة.", "Every account that can sign in. “Block” signs the person out of every device immediately.")} />
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
        <h2 className="mb-1 font-bold">{t("إضافة شخص", "Add a person")}</h2>
        <p className="mb-3 text-sm text-gray-500">{t("لصاحب مطعم أو موظف منصة. موظفين المطعم العاديين صاحب المطعم يقدر يضيفهم بنفسه من شاشة المطعم.", "For a restaurant owner or a platform employee. Restaurant owners can add their own staff from their screen.")}</p>
        <CreateUserForm roles={roleList.filter((r) => r.key !== 'SUPER_ADMIN' || ALL_PERMISSIONS.every((p) => me.platformPermissions.has(p))).map((r) => ({ key: r.key, label: roleLabel(r.key, locale, r.name), scope: r.scope }))} restaurants={restaurantList.map((r) => ({ id: r.id, name: r.nameEn }))} />
      </section>
    </div>
  );
}
