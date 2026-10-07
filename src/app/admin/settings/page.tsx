import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { adminPage, getSetting } from '@/server/admin-guard';
import { saveSettingsAction } from '@/server/actions/admin-platform';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/settings', 'platform.settings'))) return <Forbidden />;
  const [name, tz, commission] = await Promise.all([
    getSetting('platform.name', 'Campus Order'),
    getSetting('platform.timezone', 'Africa/Cairo'),
    getSetting('defaults.commissionBps', 500),
  ]);
  return (
    <div className="max-w-xl">
      <PageTitle title={t("إعدادات المنصة", "System settings")} subtitle={t("هذه القيم تُستخدم عند إنشاء مطعم جديد. يمكنك تعديل كل مطعم من إعداداته.", "Platform-wide defaults. Per-restaurant values live on each restaurant.")} />
      <ActionForm action={saveSettingsAction} className="card space-y-3">
        <div><label className="label" htmlFor="platform-name">{t("اسم المنصة", "Platform name")}</label><input id="platform-name" name="platformName" defaultValue={name} className="input" /></div>
        <div><label className="label" htmlFor="platform-timezone">{t("المنطقة الزمنية للتقارير", "Reporting timezone")}</label><input id="platform-timezone" name="timezone" defaultValue={tz} className="input" /></div>
        <div><label className="label" htmlFor="platform-commission">{t("العمولة الافتراضية للمطاعم الجديدة (%)", "Default commission for new restaurants (%)")}</label><input id="platform-commission" name="defaultCommissionPercent" defaultValue={commission / 100} className="input" inputMode="decimal" /></div>
        <SubmitButton>{t("حفظ", "Save")}</SubmitButton>
      </ActionForm>
      <p className="mt-3 text-xs text-gray-500">{t('يمكن ضبط وقت التحضير لكل مطعم من تبويب «وقت التحضير».', 'Set each restaurant preparation time on its Preparation time tab.')}</p>
    </div>
  );
}
