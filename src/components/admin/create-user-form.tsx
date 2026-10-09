'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { useLanguage } from '@/components/language-provider';
import { createUserAction } from '@/server/actions/admin-platform';

/** Add a person and (optionally) give them a role. A restaurant role also needs the restaurant. */
export function CreateUserForm({ roles, restaurants }: { roles: { key: string; label: string; scope: 'PLATFORM' | 'STORE' }[]; restaurants: { id: string; name: string }[] }) {
  const { t } = useLanguage();
  const [roleKey, setRoleKey] = useState('');
  const role = roles.find((r) => r.key === roleKey);
  return (
    <ActionForm action={createUserAction} className="grid gap-3 md:grid-cols-2">
      <label className="block"><span className="label">{t('الاسم', 'Name')}</span><input name="name" className="input" required minLength={2} maxLength={80} autoComplete="off" /></label>
      <label className="block"><span className="label">{t('الإيميل (بيدخل بيه)', 'Email (used to sign in)')}</span><input name="email" type="email" className="input" required dir="ltr" autoComplete="off" /></label>
      <label className="block"><span className="label">{t('كلمة سر مبدئية (٨ حروف على الأقل)', 'Initial password (8+ characters)')}</span><input name="password" type="password" className="input" required minLength={8} autoComplete="new-password" /><span className="mt-1 block text-xs text-gray-500">{t('ابعتهاله بطريقة آمنة واطلب منه يغيّرها.', 'Send it privately and ask them to change it.')}</span></label>
      <label className="block"><span className="label">{t('الدور', 'Role')}</span>
        <select name="roleKey" className="input" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          <option value="">{t('— من غير دور دلوقتي —', '— no role yet —')}</option>
          <optgroup label={t('موظفين المنصة', 'Platform staff')}>{roles.filter((r) => r.scope === 'PLATFORM').map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</optgroup>
          <optgroup label={t('موظفين مطعم', 'Restaurant staff')}>{roles.filter((r) => r.scope === 'STORE').map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</optgroup>
        </select>
        <span className="mt-1 block text-xs text-gray-500">{t('عايز صلاحيات محددة؟ اعمل دور الأول من «الأدوار والصلاحيات».', 'Need specific permissions? Create a role first under “Roles & permissions”.')}</span>
      </label>
      {role?.scope === 'STORE' && (
        <label className="block"><span className="label">{t('في أنهي مطعم؟', 'Which restaurant?')}</span>
          <select name="restaurantId" className="input" required defaultValue="">
            <option value="" disabled>{t('اختار المطعم', 'Choose the restaurant')}</option>
            {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      )}
      <div className="md:col-span-2"><SubmitButton>{t('إضافة', 'Add')}</SubmitButton></div>
    </ActionForm>
  );
}
