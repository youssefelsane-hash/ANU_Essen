import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { adminPage } from '@/server/admin-guard';
import { can } from '@/server/auth/authz';
import { getRestaurant } from '@/server/services/store';
import { MenuManager } from '@/components/menu/menu-manager';
import { Forbidden, PageTitle, RestaurantTabs } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function AdminMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await adminPage(`/admin/restaurants/${id}/menu`, 'platform.restaurants');
  if (!auth) return <Forbidden />;
  const r = await getRestaurant(db(), id);
  if (!r) notFound();
  return (
    <div>
      <PageTitle
        title={`${localizedName(locale, r.nameAr, r.nameEn)} — ${text(locale, 'المنيو', 'Menu')}`}
        subtitle={text(locale, 'صاحب ومدير المطعم يقدروا يعدلوا المنيو ده بنفسهم من شاشة المطعم.', 'The restaurant owner and manager can edit this menu themselves from the restaurant screen.')}
      />
      <RestaurantTabs id={id} active="menu" />
      <MenuManager restaurantId={id} basePath={`/admin/restaurants/${id}/menu`} showLoad={can(auth, 'platform.queue')} />
    </div>
  );
}
