import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { roles, userRoles, users } from '@/server/db/schema';
import { createStaffAction, removeStaffRoleAction, resetStaffPasswordAction, setStaffBlockedAction } from '@/server/actions/merchant';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PROTECTED_ROLE_KEYS } from '@/lib/domain/permissions';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { formatDateTime } from '@/lib/domain/misc';
import { MIN_PASSWORD_LENGTH } from '@/server/auth/password';

/** Staff list + add form for one restaurant (used by the merchant owner and the super admin). */
export async function StaffManager({ restaurantId, canAssignProtected, currentUserId, timezone = 'Africa/Cairo' }: { restaurantId: string; canAssignProtected: boolean; currentUserId: string; timezone?: string }) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const roleLabels: Record<string, string> = {
    MERCHANT_OWNER: t('صاحب المطعم — إدارة كاملة', 'Owner — full restaurant access'),
    MERCHANT_MANAGER: t('مدير المطعم — متابعة التشغيل', 'Manager — daily operations'),
    CASHIER: t('الكاشير — قبول الطلبات ومراجعة الدفع', 'Cashier — orders & payments'),
    KITCHEN_STAFF: t('المطبخ — تحضير الطلبات', 'Kitchen — prepare orders'),
    DELIVERY_STAFF: t('التوصيل — استلام وتسليم الطلبات', 'Courier — collect & deliver'),
  };
  const [assignments, storeRoles] = await Promise.all([
    db()
      .select({ id: userRoles.id, userId: users.id, name: users.name, email: users.email, isActive: users.isActive, roleKey: roles.key, roleName: roles.name, lastLoginAt: users.lastLoginAt })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.restaurantId, restaurantId)))
      .orderBy(asc(users.name)),
    db().select().from(roles).where(eq(roles.scope, 'STORE')).orderBy(asc(roles.name)),
  ]);
  const assignable = storeRoles.filter((r) => canAssignProtected || !PROTECTED_ROLE_KEYS.includes(r.key));
  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
        {t('أضف كل فرد في الفريق وحدد مهمته. إيقاف الحساب يمنع الدخول ويخرج صاحبه من كل الأجهزة.', 'Add each team member and choose their job. Disabling an account signs them out on every device.')}
      </p>
      <section className="card overflow-x-auto">
        <h2 className="mb-3 font-bold">{t('الفريق الحالي', 'Your team')}</h2>
        <table className="table">
          <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('البريد الإلكتروني', 'Email')}</th><th>{t('المهمة', 'Job')}</th><th>{t('آخر دخول', 'Last sign-in')}</th><th>{t('إدارة الحساب', 'Account')}</th></tr></thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td className="font-semibold">{a.name}{!a.isActive && <span className="badge ms-2 bg-red-100 text-red-700">{t('موقوف', 'Disabled')}</span>}</td>
                <td dir="ltr">{a.email}</td>
                <td>{roleLabels[a.roleKey] ?? a.roleName}</td>
                <td className="text-xs text-gray-500">{a.lastLoginAt ? formatDateTime(a.lastLoginAt, timezone, locale) : t('لم يدخل بعد', 'Not signed in yet')}</td>
                <td>
                  {a.userId === currentUserId ? <span className="text-sm text-gray-500">{t('حسابك', 'You')}</span> : (
                    <details className="min-w-44">
                      <summary className="cursor-pointer rounded-lg px-3 py-2 font-semibold text-blue-800">{t('إدارة', 'Manage')}</summary>
                      <div className="mt-3 space-y-3">
                        <form action={setStaffBlockedAction.bind(null, restaurantId, a.userId, a.isActive)}>
                          <button className={`btn btn-sm ${a.isActive ? 'btn-danger' : 'btn-success'}`}>{a.isActive ? t('إيقاف الحساب', 'Disable account') : t('تفعيل الحساب', 'Enable account')}</button>
                        </form>
                        <ActionForm action={resetStaffPasswordAction} className="space-y-2">
                          <input type="hidden" name="restaurantId" value={restaurantId} />
                          <input type="hidden" name="userId" value={a.userId} />
                          <label className="label" htmlFor={`password-${a.id}`}>{t('كلمة مرور جديدة', 'New password')}</label>
                          <input id={`password-${a.id}`} name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} className="input min-w-44 py-2" autoComplete="new-password" />
                          <SubmitButton className="btn btn-secondary btn-sm">{t('حفظ كلمة المرور', 'Save password')}</SubmitButton>
                        </ActionForm>
                        {(canAssignProtected || !PROTECTED_ROLE_KEYS.includes(a.roleKey)) && (
                          <form action={removeStaffRoleAction.bind(null, a.id)}>
                            <button className="btn btn-ghost btn-sm text-red-600">{t('إزالة من هذه المهمة', 'Remove this job')}</button>
                          </form>
                        )}
                      </div>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {assignments.length === 0 && <p className="py-4 text-center text-gray-400">{t('لم تضف أي أفراد بعد.', 'No team members yet.')}</p>}
      </section>
      <section className="card">
        <h2 className="mb-3 text-lg font-bold">{t('إضافة فرد للفريق', 'Add a team member')}</h2>
        <ActionForm action={createStaffAction} resetOnSuccess className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <div><label className="label" htmlFor="staff-name">{t('الاسم', 'Name')}</label><input id="staff-name" name="name" required minLength={2} maxLength={80} className="input" autoComplete="name" /></div>
          <div><label className="label" htmlFor="staff-email">{t('البريد الإلكتروني', 'Email')}</label><input id="staff-email" name="email" type="email" required className="input" dir="ltr" autoComplete="email" /></div>
          <div>
            <label className="label" htmlFor="staff-password">{t('كلمة المرور', 'Password')}</label>
            <input id="staff-password" name="password" type="password" minLength={MIN_PASSWORD_LENGTH} className="input" autoComplete="new-password" aria-describedby="staff-password-help" />
            <p id="staff-password-help" className="mt-1 text-xs text-gray-500">{t(`للحساب الجديد: ${MIN_PASSWORD_LENGTH} أحرف على الأقل. اتركها فارغة إذا كان لديه حساب.`, `New accounts: at least ${MIN_PASSWORD_LENGTH} characters. Leave blank if they already have an account.`)}</p>
          </div>
          <div>
            <label className="label" htmlFor="staff-role">{t('مهمته في المطعم', 'Their job')}</label>
            <select id="staff-role" name="roleKey" className="input" defaultValue="KITCHEN_STAFF">
              {assignable.map((r) => <option key={r.id} value={r.key}>{roleLabels[r.key] ?? r.name}</option>)}
            </select>
          </div>
          <SubmitButton className="btn btn-primary md:col-span-2">{t('إضافة للفريق', 'Add to team')}</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
