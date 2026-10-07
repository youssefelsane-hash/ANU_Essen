import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { adminPage, getSetting } from '@/server/admin-guard';
import { savePlatformProfileAction, saveSettingsAction } from '@/server/actions/admin-platform';
import { getPlatformProfile } from '@/server/platform-profile';
import type { PlatformProfile } from '@/lib/domain/platform-profile';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/settings', 'platform.settings'))) return <Forbidden />;
  const [name, tz, commission, profile] = await Promise.all([
    getSetting('platform.name', 'Campus Order'),
    getSetting('platform.timezone', 'Africa/Cairo'),
    getSetting('defaults.commissionBps', 500),
    getPlatformProfile(),
  ]);
  const field = (key: keyof PlatformProfile, ar: string, en: string, opts: { dir?: 'ltr' | 'rtl'; placeholder?: string; wide?: boolean } = {}) => (
    <div className={opts.wide ? 'sm:col-span-2' : undefined}>
      <label className="label" htmlFor={`profile-${key}`}>{t(ar, en)}</label>
      <input id={`profile-${key}`} name={key} defaultValue={profile[key] ?? ''} className="input" dir={opts.dir} placeholder={opts.placeholder} />
    </div>
  );
  return (
    <div className="max-w-3xl space-y-6">
      <PageTitle title={t("إعدادات المنصة", "System settings")} subtitle={t("هذه القيم تُستخدم عند إنشاء مطعم جديد. يمكنك تعديل كل مطعم من إعداداته.", "Platform-wide defaults. Per-restaurant values live on each restaurant.")} />
      <ActionForm action={saveSettingsAction} className="card space-y-3">
        <div><label className="label" htmlFor="platform-name">{t("اسم المنصة", "Platform name")}</label><input id="platform-name" name="platformName" defaultValue={name} className="input" /></div>
        <div><label className="label" htmlFor="platform-timezone">{t("المنطقة الزمنية للتقارير", "Reporting timezone")}</label><input id="platform-timezone" name="timezone" defaultValue={tz} className="input" /></div>
        <div><label className="label" htmlFor="platform-commission">{t("العمولة الافتراضية للمطاعم الجديدة (%)", "Default commission for new restaurants (%)")}</label><input id="platform-commission" name="defaultCommissionPercent" defaultValue={commission / 100} className="input" inputMode="decimal" /></div>
        <SubmitButton>{t("حفظ", "Save")}</SubmitButton>
      </ActionForm>
      <p className="mt-3 text-xs text-gray-500">{t('يمكن ضبط وقت التحضير لكل مطعم من تبويب «وقت التحضير».', 'Set each restaurant preparation time on its Preparation time tab.')}</p>

      <section className="space-y-2" id="profile">
        <h2 className="text-lg font-bold">{t('هوية المنصة والفوتر', 'Platform identity & footer')}</h2>
        <p className="text-sm text-gray-600">{t('بتظهر في الصفحة الرئيسية وفوتر كل الصفحات وصفحات السياسات. أي خانة تواصل فاضية مش هتظهر.', 'Shown on the home page, every footer and the policy pages. Empty contact fields are hidden.')}</p>
        <ActionForm action={savePlatformProfileAction} className="card grid gap-3 sm:grid-cols-2">
          {field('orderAheadAr', 'جملة الطلب المسبق (عربي)', 'Order-ahead line (Arabic)', { wide: true })}
          {field('orderAheadEn', 'جملة الطلب المسبق (إنجليزي)', 'Order-ahead line (English)', { wide: true, dir: 'ltr' })}
          {field('nameAr', 'اسم المنصة بالعربي', 'Platform name (Arabic)')}
          {field('nameEn', 'اسم المنصة بالإنجليزي', 'Platform name (English)', { dir: 'ltr' })}
          {field('descriptionAr', 'وصف قصير (عربي)', 'Short description (Arabic)', { wide: true })}
          {field('descriptionEn', 'وصف قصير (إنجليزي)', 'Short description (English)', { wide: true, dir: 'ltr' })}
          {field('companyAr', 'الشركة المالكة (عربي)', 'Owning company (Arabic)')}
          {field('companyEn', 'الشركة المالكة (إنجليزي)', 'Owning company (English)', { dir: 'ltr' })}
          {field('whatsapp', 'رقم واتساب الدعم', 'Support WhatsApp number', { dir: 'ltr', placeholder: '01xxxxxxxxx' })}
          {field('email', 'بريد الدعم', 'Support email', { dir: 'ltr' })}
          {field('facebookUrl', 'رابط فيسبوك', 'Facebook link', { dir: 'ltr', placeholder: 'https://facebook.com/…' })}
          {field('instagramUrl', 'رابط إنستجرام', 'Instagram link', { dir: 'ltr', placeholder: 'https://instagram.com/…' })}
          {field('tiktokUrl', 'رابط تيك توك', 'TikTok link', { dir: 'ltr', placeholder: 'https://tiktok.com/@…' })}
          {field('addressAr', 'العنوان', 'Address')}
          {field('commercialRegister', 'السجل التجاري', 'Commercial register no.', { dir: 'ltr' })}
          {field('taxId', 'الرقم الضريبي', 'Tax ID', { dir: 'ltr' })}
          <div className="sm:col-span-2"><SubmitButton>{t('حفظ الهوية', 'Save identity')}</SubmitButton></div>
        </ActionForm>
      </section>
    </div>
  );
}
