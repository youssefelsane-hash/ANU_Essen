import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { adminPage, getSetting } from '@/server/admin-guard';
import { savePlatformProfileAction, saveSettingsAction } from '@/server/actions/admin-platform';
import { getPlatformProfile } from '@/server/platform-profile';
import { getRiskPolicy } from '@/server/services/risk';
import { saveRiskPolicyAction } from '@/server/actions/customers';
import type { PlatformProfile } from '@/lib/domain/platform-profile';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!(await adminPage('/admin/settings', 'platform.settings'))) return <Forbidden />;
  const [name, tz, commission, profile, defaultServiceFee, risk] = await Promise.all([
    getSetting('platform.name', 'Campus Order'),
    getSetting('platform.timezone', 'Africa/Cairo'),
    getSetting('defaults.commissionBps', 500),
    getPlatformProfile(),
    getSetting('defaults.serviceFee', 0),
    getRiskPolicy(),
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
        <div><label className="label" htmlFor="platform-name">{t("اسم المنصة (للنظام الداخلي)", "Platform name (internal)")}</label><input id="platform-name" name="platformName" defaultValue={name} className="input" /><p className="mt-1 text-xs text-gray-500">{t('الاسم اللي العملاء بيشوفوه بيتعدل تحت في «هوية المنصة».', 'The name customers see is edited below under “Platform identity”.')}</p></div>
        <div><label className="label" htmlFor="platform-timezone">{t("المنطقة الزمنية للتقارير", "Reporting timezone")}</label><input id="platform-timezone" name="timezone" defaultValue={tz} className="input" dir="ltr" /><p className="mt-1 text-xs text-gray-500">{t('سيبها Africa/Cairo لمصر. بتحدد بداية ونهاية «اليوم» في التقارير.', 'Keep Africa/Cairo for Egypt. It decides where a reporting “day” starts and ends.')}</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="platform-commission">{t("نسبة المنصة للمطاعم الجديدة (%)", "Default platform % for new restaurants")}</label><input id="platform-commission" name="defaultCommissionPercent" defaultValue={commission / 100} className="input" inputMode="decimal" dir="ltr" /></div>
          <div><label className="label" htmlFor="platform-service-fee">{t("المبلغ الثابت للمطاعم الجديدة (ج.م)", "Default fixed fee for new restaurants (EGP)")}</label><input id="platform-service-fee" name="defaultServiceFee" defaultValue={defaultServiceFee / 100} className="input" inputMode="decimal" dir="ltr" /></div>
        </div>
        <p className="text-xs text-gray-500">{t('دي القيم اللي بتتحط تلقائي لما تضيف مطعم جديد. كل مطعم ليه إعداداته الخاصة في صفحته (نسبة، مبلغ ثابت، وتوصيل المنصة).', 'These are applied when you add a new restaurant. Each restaurant has its own values on its page (percentage, fixed fee and platform delivery).')}</p>
        <SubmitButton>{t("حفظ", "Save")}</SubmitButton>
      </ActionForm>
      <p className="mt-3 text-xs text-gray-500">{t('يمكن ضبط وقت التحضير لكل مطعم من تبويب «وقت التحضير».', 'Set each restaurant preparation time on its Preparation time tab.')}</p>

      <section className="space-y-2" id="protection">
        <h2 className="text-lg font-bold">{t('الحماية من الطلبات الوهمية', 'Protection from fake orders')}</h2>
        <p className="text-sm text-gray-600">{t('الطلب من غير حساب، فرقم الموبايل هو اللي بيتحاسب. الحدود دي بتحمي المطاعم من طلبات كاش بتتعمل ومحدش بيستلمها.', 'Ordering needs no account, so the phone number carries the rules. These limits protect restaurants from cash orders nobody collects.')}</p>
        <ActionForm action={saveRiskPolicyAction} className="card grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">{t('أقصى عدد طلبات مفتوحة لنفس الرقم (كل المطاعم)', 'Max open orders per phone (all restaurants)')}</span><input name="maxOpenOrdersPerPhone" type="number" min="0" max="20" defaultValue={risk.maxOpenOrdersPerPhone} className="input" inputMode="numeric" /><span className="mt-1 block text-xs text-gray-500">{t('مثلاً 3. صفر = بدون حد.', 'e.g. 3. 0 = no limit.')}</span></label>
          <label className="block"><span className="label">{t('بعد كام مرة «ما استلمش» الرقم يدفع إنستاباي بس؟', 'After how many no-shows must the number pay by InstaPay?')}</span><input name="noShowCashLimit" type="number" min="0" max="20" defaultValue={risk.noShowCashLimit} className="input" inputMode="numeric" /><span className="mt-1 block text-xs text-gray-500">{t('مثلاً 2. صفر = ما تقفلش الكاش أبدًا. المطعم بيسجل «العميل ما استلمش» من صفحة الطلب.', 'e.g. 2. 0 = never turn cash off. Restaurants record “did not collect” on the order page.')}</span></label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3"><SubmitButton>{t('حفظ الحماية', 'Save protection')}</SubmitButton><a href="/admin/customers" className="text-sm text-blue-700">{t('إيقاف رقم معين ← صفحة العملاء', 'Block a specific number → Customers')}</a></div>
        </ActionForm>
      </section>

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
