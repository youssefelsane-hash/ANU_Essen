import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { roles, userRoles, users } from '@/server/db/schema';
import { createStaffAction, removeStaffRoleAction, resetStaffPasswordAction, setStaffBlockedAction } from '@/server/actions/merchant';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PROTECTED_ROLE_KEYS } from '@/lib/domain/permissions';

/** Staff list + add form for one restaurant (used by the merchant owner and the super admin). */
export async function StaffManager({ restaurantId, canAssignProtected, currentUserId }: { restaurantId: string; canAssignProtected: boolean; currentUserId: string }) {
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
        Only the emails listed here can sign in to this restaurant. Block someone to sign them out on every device immediately.
        <span className="block" dir="rtl">الإيميلات اللي في الجدول ده بس هي اللي تقدر تدخل على المطعم. «Block» بيقفل الحساب ويطلّعه من كل الأجهزة فورًا.</span>
      </p>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td className="font-semibold">{a.name}{!a.isActive && <span className="badge ms-2 bg-red-100 text-red-700">blocked · موقوف</span>}</td>
                <td dir="ltr">{a.email}</td>
                <td>{a.roleName}</td>
                <td className="text-xs text-gray-500">{a.lastLoginAt ? a.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : '—'}</td>
                <td className="space-y-2">
                  {a.userId !== currentUserId && (canAssignProtected || !PROTECTED_ROLE_KEYS.includes(a.roleKey)) && (
                    <form action={removeStaffRoleAction.bind(null, a.id)}>
                      <button className="btn btn-ghost btn-sm text-red-600">Remove role</button>
                    </form>
                  )}
                  {a.userId !== currentUserId && (
                    <form action={setStaffBlockedAction.bind(null, restaurantId, a.userId, a.isActive)}>
                      <button className={`btn btn-sm ${a.isActive ? 'btn-danger' : 'btn-success'}`}>{a.isActive ? 'Block · إيقاف' : 'Unblock · تفعيل'}</button>
                    </form>
                  )}
                  {a.userId !== currentUserId && (
                    <ActionForm action={resetStaffPasswordAction} className="flex gap-1">
                      <input type="hidden" name="restaurantId" value={restaurantId} />
                      <input type="hidden" name="userId" value={a.userId} />
                      <input name="password" type="password" placeholder="New password" className="input w-36 py-1" autoComplete="new-password" />
                      <SubmitButton className="btn btn-secondary btn-sm">Reset</SubmitButton>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {assignments.length === 0 && <p className="py-4 text-center text-gray-400">No staff yet</p>}
      </section>
      <section className="card">
        <h2 className="mb-3 font-bold">Add staff member</h2>
        <ActionForm action={createStaffAction} resetOnSuccess className="grid gap-3 md:grid-cols-5">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <input name="name" placeholder="Name" required className="input" />
          <input name="email" type="email" placeholder="Email" required className="input" dir="ltr" />
          <input name="password" type="password" placeholder="Password (new users)" className="input" autoComplete="new-password" />
          <select name="roleKey" className="input" defaultValue="KITCHEN_STAFF">
            {assignable.map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}
          </select>
          <SubmitButton>Add</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-gray-500">If the email already has an account, the role is added without changing the password.</p>
      </section>
    </div>
  );
}
