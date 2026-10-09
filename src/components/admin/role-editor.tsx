'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { useLanguage } from '@/components/language-provider';
import { saveRoleAction } from '@/server/actions/admin-platform';
import { PERMISSION_GROUPS, PERMISSION_HELP, PLATFORM_ROLE_TEMPLATES } from '@/lib/domain/permission-help';

interface Perm { key: string; scope: 'PLATFORM' | 'STORE' }

/**
 * Checkbox editor for a role's permissions, grouped with plain-language help. For a new platform
 * employee it offers ready-made templates; permissions the current admin lacks are shown disabled
 * (the server refuses them anyway).
 */
export function RoleEditor({ roleId, scope: initialScope, permissions, granted, mine, isNew = false }: { roleId?: string; scope: 'PLATFORM' | 'STORE'; permissions: Perm[]; granted: string[]; mine: string[]; isNew?: boolean }) {
  const { t } = useLanguage();
  const [scope, setScope] = useState(initialScope);
  const [checked, setChecked] = useState(() => new Set(granted));
  const owned = new Set(mine);
  const available = permissions.filter((p) => scope === 'PLATFORM' || p.scope === 'STORE');
  const toggle = (key: string) => setChecked((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const allowed = (p: Perm) => scope === 'STORE' || owned.has(p.key);

  return (
    <ActionForm action={saveRoleAction} resetOnSuccess={false} className="space-y-4">
      {roleId && <input type="hidden" name="id" value={roleId} />}
      {isNew && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">{t('اسم الدور (اللي هيظهر لك)', 'Role name (what you will see)')}</span><input name="name" className="input" required minLength={2} maxLength={60} placeholder={t('مثلاً: موظف خدمة العملاء', 'e.g. Support agent')} /></label>
          <div><span className="label">{t('الدور ده لمين؟', 'Who is this role for?')}</span>
            <div className="grid gap-2">
              <label className="flex items-start gap-2 rounded-xl bg-white p-2 text-sm"><input type="radio" name="scope" value="PLATFORM" checked={scope === 'PLATFORM'} onChange={() => setScope('PLATFORM')} className="mt-1" /><span>{t('موظف بيساعدك في إدارة المنصة (كل المطاعم)', 'A platform employee (all restaurants)')}</span></label>
              <label className="flex items-start gap-2 rounded-xl bg-white p-2 text-sm"><input type="radio" name="scope" value="STORE" checked={scope === 'STORE'} onChange={() => setScope('STORE')} className="mt-1" /><span>{t('موظف جوه مطعم واحد', 'Staff inside one restaurant')}</span></label>
            </div>
          </div>
        </div>
      )}
      {isNew && scope === 'PLATFORM' && (
        <div>
          <p className="label">{t('ابدأ من قالب جاهز (وبعدين عدّل لو حابب):', 'Start from a template (then adjust if you like):')}</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_ROLE_TEMPLATES.map((tpl) => (
              <button key={tpl.key} type="button" className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-start text-sm hover:border-emerald-600" onClick={() => setChecked(new Set(tpl.permissions.filter((p) => owned.has(p))))}>
                <b className="block">{t(tpl.ar, tpl.en)}</b><small className="text-gray-500">{t(tpl.hintAr, tpl.hintEn)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {PERMISSION_GROUPS.map((g) => {
        const list = available.filter((p) => (PERMISSION_HELP[p.key]?.group ?? 'team') === g.key);
        if (!list.length) return null;
        return (
          <fieldset key={g.key}>
            <legend className="mb-2 text-sm font-bold">{t(g.ar, g.en)}</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((p) => {
                const help = PERMISSION_HELP[p.key];
                const can = allowed(p);
                return (
                  <label key={p.key} className={`flex items-start gap-2 rounded-xl p-3 text-sm ${checked.has(p.key) ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-gray-50'} ${can ? '' : 'opacity-50'}`} title={can ? undefined : t('انت نفسك معندكش الصلاحية دي', 'You do not have this permission yourself')}>
                    <input type="checkbox" name="permissions" value={p.key} checked={checked.has(p.key)} onChange={() => toggle(p.key)} disabled={!can} className="mt-1" />
                    <span>{help ? t(help.ar, help.en) : p.key}{help?.sensitive && <span className="ms-1 rounded bg-red-100 px-1 text-[10px] font-bold text-red-700">{t('حساسة', 'sensitive')}</span>}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <p className="text-xs text-gray-500">{scope === 'PLATFORM' ? t('صلاحيات الطلبات والمنيو هنا بتشتغل على كل المطاعم. ما تدّيش «الحسابات والصلاحيات» أو «إعدادات المنصة» غير لحد واثق فيه جدًا.', 'Order and menu permissions here apply to every restaurant. Only give “accounts & permissions” or “platform settings” to someone you fully trust.') : t('دور المطعم بيشتغل جوه المطعم اللي تختاره للموظف بس.', 'A restaurant role only works inside the restaurant you assign it to.')}</p>
      <SubmitButton>{isNew ? t('إنشاء الدور', 'Create role') : t('حفظ الصلاحيات', 'Save permissions')}</SubmitButton>
    </ActionForm>
  );
}
