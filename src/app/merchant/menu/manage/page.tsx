import Link from 'next/link';
import { notFound } from 'next/navigation';
import { merchantContext } from '@/server/merchant-context';
import { can } from '@/server/auth/authz';
import { MenuManager } from '@/components/menu/menu-manager';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

/** The restaurant owner / manager builds their own menu: categories, products, sizes, add-ons, photos. */
export default async function MerchantMenuManagePage() {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { auth, restaurant, permissions } = await merchantContext('/merchant/menu/manage');
  if (!restaurant || !permissions.has('menu.manage')) notFound();
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black">{t('تعديل المنيو', 'Edit menu')}</h1>
          <p className="text-sm text-gray-600">{t('أي تعديل بيظهر للعملاء على طول. الطلبات القديمة بتفضل بأسعارها.', 'Changes show to customers right away. Existing orders keep their prices.')}</p>
        </div>
        <Link href="/merchant/menu" className="btn btn-secondary btn-sm">{t('التوفر السريع', 'Quick availability')}</Link>
      </div>
      <MenuManager restaurantId={restaurant.id} basePath="/merchant/menu/manage" showLoad={can(auth, 'platform.queue')} />
    </main>
  );
}
