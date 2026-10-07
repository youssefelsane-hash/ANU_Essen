import { merchantContext } from '@/server/merchant-context';
import { StaffManager } from '@/components/staff/staff-manager';
import { getLocale } from '@/lib/i18n/server';
import { text, localizedName } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function MerchantStaffPage() {
  const locale = await getLocale('staff');
  const { auth, restaurant, permissions } = await merchantContext('/merchant/staff');
  if (!restaurant || !permissions.has('staff.manage')) return <p className="p-6 text-center">{text(locale, 'لا تملك صلاحية إدارة الفريق.', 'You do not have permission to manage the team.')}</p>;
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-2xl font-extrabold">{text(locale, 'فريق المطعم', 'Restaurant team')} — {localizedName(locale, restaurant.nameAr, restaurant.nameEn)}</h1>
      <StaffManager timezone={restaurant.timezone} restaurantId={restaurant.id} canAssignProtected={auth.platformPermissions.has('platform.users')} currentUserId={auth.user.id} />
    </main>
  );
}
