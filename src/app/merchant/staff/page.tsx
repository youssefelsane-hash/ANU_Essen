import { merchantContext } from '@/server/merchant-context';
import { StaffManager } from '@/components/staff/staff-manager';

export const dynamic = 'force-dynamic';

export default async function MerchantStaffPage() {
  const { auth, restaurant, permissions } = await merchantContext('/merchant/staff');
  if (!restaurant || !permissions.has('staff.manage')) return <p className="p-6 text-center">مش مسموح.</p>;
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4" dir="ltr">
      <h1 className="text-2xl font-extrabold">Staff — {restaurant.nameEn}</h1>
      <StaffManager restaurantId={restaurant.id} canAssignProtected={auth.platformPermissions.has('platform.users')} currentUserId={auth.user.id} />
    </main>
  );
}
