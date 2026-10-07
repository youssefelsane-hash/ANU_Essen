import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { restaurants, roles, userRoles, users } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { createUserAction } from '@/server/actions/admin-platform';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  if (!(await adminPage('/admin/users', 'platform.users'))) return <Forbidden />;
  const [list, assignments, roleList, restaurantList] = await Promise.all([
    db().select().from(users).orderBy(asc(users.name)),
    db()
      .select({ userId: userRoles.userId, role: roles.name, restaurant: restaurants.nameEn })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(restaurants, eq(restaurants.id, userRoles.restaurantId)),
    db().select().from(roles).orderBy(asc(roles.scope), asc(roles.name)),
    db().select({ id: restaurants.id, nameEn: restaurants.nameEn }).from(restaurants).orderBy(asc(restaurants.nameEn)),
  ]);
  return (
    <div className="space-y-6">
      <PageTitle title="Users & staff" />
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td><Link className="font-semibold text-blue-700" href={`/admin/users/${u.id}`}>{u.name}</Link></td>
                <td>{u.email}</td>
                <td className="text-xs">{assignments.filter((a) => a.userId === u.id).map((a) => `${a.role}${a.restaurant ? ` @ ${a.restaurant}` : ''}`).join(', ') || '—'}</td>
                <td>{u.isActive ? 'Active' : <span className="text-red-600">Disabled</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2 className="mb-3 font-bold">Create user</h2>
        <ActionForm action={createUserAction} resetOnSuccess className="grid gap-2 md:grid-cols-3">
          <input name="name" placeholder="Name" className="input" required />
          <input name="email" type="email" placeholder="Email" className="input" required />
          <input name="password" type="password" placeholder="Password (min 8)" className="input" autoComplete="new-password" required />
          <select name="roleKey" className="input">
            <option value="">— no role —</option>
            {roleList.map((r) => <option key={r.id} value={r.key}>{r.name} ({r.scope})</option>)}
          </select>
          <select name="restaurantId" className="input">
            <option value="">— restaurant (store roles) —</option>
            {restaurantList.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
          </select>
          <SubmitButton>Create</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
