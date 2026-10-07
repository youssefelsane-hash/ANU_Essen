import { adminPage } from '@/server/admin-guard';
import { normalizeAppUrl } from '@/server/env';
import { getPlatformProfile } from '@/server/platform-profile';
import { QrGenerator } from '@/components/admin/qr-generator';
import { Forbidden, PageTitle } from '@/components/admin/ui';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function PlatformQrPage() {
  const locale = await getLocale();
  if (!(await adminPage('/admin/qr', 'platform.restaurants'))) return <Forbidden />;
  const profile = await getPlatformProfile();
  return (
    <div className="space-y-4">
      <PageTitle
        title={text(locale, 'QR المنصة', 'Platform QR')}
        subtitle={text(locale, 'رمز واحد بيفتح صفحة كل المطاعم. ولكل مطعم رمزه الخاص من تبويب «التسويق» في صفحة المطعم.', 'One code that opens the page with every restaurant. Each restaurant also has its own code under its Marketing tab.')}
      />
      <section className="card">
        <QrGenerator platform={{ nameAr: profile.nameAr, nameEn: profile.nameEn }} baseUrl={normalizeAppUrl(process.env.APP_URL) ?? null} />
      </section>
    </div>
  );
}
