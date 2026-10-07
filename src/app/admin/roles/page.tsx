import { getLocale } from '@/lib/i18n/server';
import { text, roleLabel, permissionLabel } from '@/lib/i18n';
import { asc } from 'drizzle-orm';
import { db } from '@/server/db';
import { permissions, rolePermissions, roles } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { saveRoleAction } from '@/server/actions/admin-platform';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/roles', 'platform.users'))) return <Forbidden />;
  const [roleList, permList, links] = await Promise.all([
    db().select().from(roles).orderBy(asc(roles.scope), asc(roles.name)),
    db().select().from(permissions).orderBy(asc(permissions.scope), asc(permissions.key)),
    db().select().from(rolePermissions),
  ]);
  return <div className="space-y-4">
    <PageTitle title={t('الأدوار والصلاحيات', 'Roles & permissions')} subtitle={t('اختر الدور ثم حدد ما يستطيع فعله. دور المطعم يطبق في المطعم المخصص له فقط.', 'Choose a role and what it can do. Restaurant roles only apply to their assigned restaurant.')} />
    {roleList.map((r) => {
      const granted = new Set(links.filter((l) => l.roleId === r.id).map((l) => l.permissionKey));
      const available = permList.filter((p) => r.scope === 'PLATFORM' || p.scope === 'STORE');
      const locked = r.key === 'SUPER_ADMIN';
      return <details key={r.id} className="card admin-details">
        <summary className="flex flex-wrap items-center gap-3"><span>{roleLabel(r.key, locale, r.name)}</span><span className="badge bg-gray-100 text-gray-700">{r.scope === 'STORE' ? t('مطعم', 'Restaurant') : t('المنصة', 'Platform')}</span><span className="text-xs text-gray-500">{locked ? t('كل الصلاحيات', 'All permissions') : t(`${granted.size} صلاحية`, `${granted.size} permissions`)}</span></summary>
        <ActionForm action={saveRoleAction} className="mt-4">
          <input type="hidden" name="id" value={r.id} />
          <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((p) => <label key={p.key} className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm"><input type="checkbox" name="permissions" value={p.key} defaultChecked={granted.has(p.key)} className="mt-1" /><span>{permissionLabel(p.key, locale, p.description)}</span></label>)}
          </fieldset>
          {locked ? <p className="mt-3 text-xs text-gray-500">{t('مدير المنصة لديه كل الصلاحيات دائمًا.', 'The platform owner always has all permissions.')}</p> : <div className="mt-4"><SubmitButton className="btn btn-secondary">{t('حفظ الصلاحيات', 'Save permissions')}</SubmitButton></div>}
        </ActionForm>
      </details>;
    })}
    <details className="card admin-details"><summary>{t('إضافة دور جديد — متقدم', 'Add a custom role — advanced')}</summary>
      <ActionForm action={saveRoleAction} resetOnSuccess className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label><span className="label">{t('رمز الدور بالإنجليزي', 'Role code in English')}</span><input name="key" placeholder="CUSTOM_ROLE" className="input" dir="ltr" required /></label>
          <label><span className="label">{t('اسم الدور', 'Display name')}</span><input aria-label={t("الاسم", "Name")} name="name" className="input" required /></label>
          <label><span className="label">{t('مكان استخدامه', 'Where it applies')}</span><select name="scope" className="input" defaultValue="STORE"><option value="STORE">{t('مطعم', 'Restaurant')}</option><option value="PLATFORM">{t('المنصة', 'Platform')}</option></select></label>
        </div>
        <p className="text-xs text-gray-500">{t('عند اختيار دور للمطعم، تُحفظ صلاحيات المطعم فقط.', 'For restaurant roles, only restaurant permissions are saved.')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{permList.map((p) => <label key={p.key} className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm"><input type="checkbox" name="permissions" value={p.key} className="mt-1" /><span>{permissionLabel(p.key, locale, p.description)}</span></label>)}</div>
        <SubmitButton>{t('إنشاء الدور', 'Create role')}</SubmitButton>
      </ActionForm>
    </details>
  </div>;
}
