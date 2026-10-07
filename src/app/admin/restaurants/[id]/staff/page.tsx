import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant } from '@/server/services/store';
import { StaffManager } from '@/components/staff/staff-manager';
import { Forbidden, PageTitle, RestaurantTabs } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function RestaurantStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await adminPage(`/admin/restaurants/${id}/staff`, 'platform.users');
  if (!auth) return <Forbidden />;
  const r = await getRestaurant(db(), id);
  if (!r) notFound();
  return (
    <div>
      <PageTitle title={`${localizedName(locale, r.nameAr, r.nameEn)} — ${t("الفريق", "Team")}`} />
      <RestaurantTabs id={id} active="staff" />
      <StaffManager restaurantId={id} timezone={r.timezone} canAssignProtected currentUserId={auth.user.id} />
    </div>
  );
}
