import Link from 'next/link';
import { getLocale } from '@/lib/i18n/server';
import { text, roleLabel } from '@/lib/i18n';
import { asc } from 'drizzle-orm';
import { db } from '@/server/db';
import { permissions, rolePermissions, roles } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { RoleEditor } from '@/components/admin/role-editor';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const auth = await adminPage('/admin/roles', 'platform.users');
  if (!auth) return <Forbidden />;
  const [roleList, permList, links] = await Promise.all([
    db().select().from(roles).orderBy(asc(roles.scope), asc(roles.name)),
    db().select().from(permissions).orderBy(asc(permissions.scope), asc(permissions.key)),
    db().select().from(rolePermissions),
  ]);
  const mine = [...auth.platformPermissions];
  const perms = permList.map((p) => ({ key: p.key, scope: p.scope }));
  return <div className="space-y-4">
    <PageTitle title={t('الأدوار والصلاحيات', 'Roles & permissions')} subtitle={t('الدور = مجموعة صلاحيات. بتدّي الدور للموظف، فيقدر يعمل اللي في الدور بس.', 'A role is a set of permissions. Give a role to someone and they can do only what is in it.')} />

    <section className="card space-y-2 text-sm leading-7">
      <h2 className="font-bold">{t('عايز تضيف موظف يساعدك في المنصة بصلاحيات محدودة؟', 'Adding a platform employee with limited permissions?')}</h2>
      <ol className="list-decimal space-y-1 ps-5">
        <li>{t('افتح «إضافة دور جديد» تحت، اختار «موظف بيساعدك في إدارة المنصة»، واختار قالب جاهز (مثلاً «خدمة العملاء») أو علّم الصلاحيات بنفسك.', 'Open “Add a new role” below, choose “A platform employee”, then pick a template (e.g. “Customer support”) or tick permissions yourself.')}</li>
        <li>{t('روح ', 'Go to ')}<Link className="text-blue-700 underline" href="/admin/users">{t('المستخدمون والفريق', 'Team members')}</Link>{t(' وضيف الموظف بإيميله وكلمة سر، واختار الدور اللي عملته.', ', add the person with an email and password, and choose the role you made.')}</li>
        <li>{t('الموظف بيدخل من صفحة «دخول فريق العمل» ويشوف الأجزاء المسموحة له بس. تقدر تعدّل صلاحياته أو توقفه في أي وقت.', 'They sign in from “Staff sign in” and only see what they are allowed to. You can change or block them anytime.')}</li>
      </ol>
      <p className="text-xs text-gray-500">{t('للأمان: محدش يقدر يدّي صلاحية هو نفسه معندوش، ومحدش يقدر يعدّل حساب عنده صلاحيات أكتر منه.', 'For safety: nobody can grant a permission they do not have, or change an account that has more permissions than they do.')}</p>
    </section>

    <details className="card admin-details" open={roleList.filter((r) => !r.isSystem).length === 0 || undefined}>
      <summary>{t('إضافة دور جديد', 'Add a new role')}</summary>
      <div className="mt-4"><RoleEditor scope="PLATFORM" permissions={perms} granted={[]} mine={mine} isNew /></div>
    </details>

    <h2 className="pt-2 font-bold">{t('الأدوار الموجودة', 'Existing roles')}</h2>
    {roleList.map((r) => {
      const granted = links.filter((l) => l.roleId === r.id).map((l) => l.permissionKey);
      const locked = r.key === 'SUPER_ADMIN';
      return <details key={r.id} className="card admin-details">
        <summary className="flex flex-wrap items-center gap-3"><span>{roleLabel(r.key, locale, r.name)}</span><span className="badge bg-gray-100 text-gray-700">{r.scope === 'STORE' ? t('جوه مطعم', 'Restaurant') : t('المنصة', 'Platform')}</span>{!r.isSystem && <span className="badge bg-blue-50 text-blue-700">{t('دور انت عامله', 'Custom')}</span>}<span className="text-xs text-gray-500">{locked ? t('كل الصلاحيات', 'All permissions') : t(`${granted.length} صلاحية`, `${granted.length} permissions`)}</span></summary>
        <div className="mt-4">
          {locked
            ? <p className="text-sm text-gray-500">{t('صاحب المنصة معاه كل الصلاحيات دايمًا ومينفعش تتغير.', 'The platform owner always has every permission.')}</p>
            : <RoleEditor roleId={r.id} scope={r.scope} permissions={perms} granted={granted} mine={mine} />}
        </div>
      </details>;
    })}
  </div>;
}
