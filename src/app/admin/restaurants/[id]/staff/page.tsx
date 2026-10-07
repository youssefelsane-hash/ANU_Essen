import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant } from '@/server/services/store';
import { StaffManager } from '@/components/staff/staff-manager';
import { Forbidden, PageTitle, RestaurantTabs } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function RestaurantStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await adminPage(`/admin/restaurants/${id}/staff`, 'platform.users');
  if (!auth) return <Forbidden />;
  const r = await getRestaurant(db(), id);
  if (!r) notFound();
  return (
    <div>
      <PageTitle title={`${r.nameEn} — Staff`} />
      <RestaurantTabs id={id} active="staff" />
      <StaffManager restaurantId={id} canAssignProtected currentUserId={auth.user.id} />
    </div>
  );
}
