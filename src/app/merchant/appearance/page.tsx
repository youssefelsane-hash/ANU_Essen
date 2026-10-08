import { eq } from 'drizzle-orm';
import { AppearanceEditor } from '@/components/merchant/appearance-editor';
import { text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { db } from '@/server/db';
import { restaurants } from '@/server/db/schema';
import { merchantContext } from '@/server/merchant-context';

export const dynamic = 'force-dynamic';

export default async function MerchantAppearancePage() {
  const { restaurant, permissions } = await merchantContext('/merchant/appearance');
  if (!restaurant) return null;
  const locale = await getLocale('staff');
  if (!permissions.has('store.profile')) return <p className="p-6 text-center">{text(locale, 'لا تملك صلاحية تعديل شكل المطعم.', 'You do not have permission to edit this restaurant’s appearance.')}</p>;
  const [profile] = await db().select().from(restaurants).where(eq(restaurants.id, restaurant.id));
  if (!profile) return null;
  return <AppearanceEditor key={profile.id} restaurant={{ id: profile.id, slug: profile.slug, nameAr: profile.nameAr, nameEn: profile.nameEn, badgeText: profile.badgeText, badgeTextEn: profile.badgeTextEn, taglineAr: profile.taglineAr, taglineEn: profile.taglineEn, brandColor: profile.brandColor, logoUrl: profile.logoUrl, coverImageUrl: profile.coverImageUrl }} />;
}
