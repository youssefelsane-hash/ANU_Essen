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
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await adminPage(`/admin/users/${id}`, 'platform.users');
  if (!auth) return <Forbidden />;
  const [u] = await db().select().from(users).where(eq(users.id, id));
  if (!u) notFound();
  const [assignments, roleList, restaurantList] = await Promise.all([
    db()
      .select({ id: userRoles.id, role: roles.name, scope: roles.scope, restaurant: restaurants.nameEn })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(restaurants, eq(restaurants.id, userRoles.restaurantId))
      .where(eq(userRoles.userId, id)),
    db().select().from(roles).orderBy(asc(roles.scope), asc(roles.name)),
    db().select({ id: restaurants.id, nameEn: restaurants.nameEn }).from(restaurants).orderBy(asc(restaurants.nameEn)),
  ]);
  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/admin/users" className="text-sm text-blue-700">← Users</Link>
      <PageTitle title={u.name} subtitle={u.email}>
        {u.id !== auth.user.id && (
          <form action={setUserActiveAction.bind(null, u.id, !u.isActive)}>
            <button className={`btn btn-sm ${u.isActive ? 'btn-danger' : 'btn-success'}`}>{u.isActive ? 'Disable user' : 'Enable user'}</button>
          </form>
        )}
      </PageTitle>
      <section className="card">
        <h2 className="mb-2 font-bold">Roles</h2>
        <table className="table">
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td>{a.role}</td>
                <td>{a.scope === 'PLATFORM' ? 'Platform-wide' : a.restaurant}</td>
                <td><form action={removeRoleAction.bind(null, a.id)}><button className="btn btn-ghost btn-sm text-red-600">Remove</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionForm action={assignRoleAction} className="mt-3 grid gap-2 sm:grid-cols-3">
          <input type="hidden" name="userId" value={u.id} />
          <select name="roleKey" className="input">
            {roleList.map((r) => <option key={r.id} value={r.key}>{r.name} ({r.scope})</option>)}
          </select>
          <select name="restaurantId" className="input">
            <option value="">— restaurant (store roles) —</option>
            {restaurantList.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
          </select>
          <SubmitButton className="btn btn-secondary">Assign role</SubmitButton>
        </ActionForm>
      </section>
      <section className="card">
        <h2 className="mb-2 font-bold">Reset password</h2>
        <ActionForm action={resetPasswordAction} resetOnSuccess className="flex gap-2">
          <input type="hidden" name="userId" value={u.id} />
          <input name="password" type="password" placeholder="New password" className="input max-w-xs" autoComplete="new-password" required />
          <SubmitButton className="btn btn-secondary">Reset</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
