import { asc } from 'drizzle-orm';
import { db } from '@/server/db';
import { permissions, rolePermissions, roles } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { saveRoleAction } from '@/server/actions/admin-platform';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  if (!(await adminPage('/admin/roles', 'platform.users'))) return <Forbidden />;
  const [roleList, permList, links] = await Promise.all([
    db().select().from(roles).orderBy(asc(roles.scope), asc(roles.name)),
    db().select().from(permissions).orderBy(asc(permissions.scope), asc(permissions.key)),
    db().select().from(rolePermissions),
  ]);
  return (
    <div className="space-y-6">
      <PageTitle title="Roles & permissions" subtitle="Store roles apply inside the restaurant they are assigned to; they can never hold platform permissions." />
      {roleList.map((r) => {
        const granted = new Set(links.filter((l) => l.roleId === r.id).map((l) => l.permissionKey));
        const available = permList.filter((p) => r.scope === 'PLATFORM' || p.scope === 'STORE');
        const locked = r.key === 'SUPER_ADMIN';
        return (
          <section key={r.id} className="card">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="font-bold">{r.name}</h2>
              <code className="text-xs text-gray-500">{r.key}</code>
              <span className="badge bg-gray-100 text-gray-700">{r.scope}</span>
              {r.isSystem && <span className="badge bg-blue-100 text-blue-800">system</span>}
            </div>
            <ActionForm action={saveRoleAction}>
              <input type="hidden" name="id" value={r.id} />
              <fieldset disabled={locked} className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {available.map((p) => (
                  <label key={p.key} className="flex items-start gap-2 text-sm" title={p.description}>
                    <input type="checkbox" name="permissions" value={p.key} defaultChecked={granted.has(p.key)} className="mt-1" />
                    <span><code className="text-xs">{p.key}</code><span className="block text-xs text-gray-500">{p.description}</span></span>
                  </label>
                ))}
              </fieldset>
              {!locked && <div className="mt-3"><SubmitButton className="btn btn-secondary btn-sm">Save permissions</SubmitButton></div>}
            </ActionForm>
          </section>
        );
      })}
      <section className="card">
        <h2 className="mb-3 font-bold">Create custom role</h2>
        <ActionForm action={saveRoleAction} resetOnSuccess className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <input name="key" placeholder="KEY_NAME" className="input" required />
            <input name="name" placeholder="Display name" className="input" required />
            <select name="scope" className="input" defaultValue="STORE"><option value="STORE">STORE</option><option value="PLATFORM">PLATFORM</option></select>
          </div>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {permList.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name="permissions" value={p.key} /> <code className="text-xs">{p.key}</code></label>
            ))}
          </div>
          <SubmitButton>Create role</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
