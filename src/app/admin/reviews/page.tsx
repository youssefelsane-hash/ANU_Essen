import { db } from '@/server/db';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { listReviews } from '@/server/services/reviews';
import { ReviewsList } from '@/components/support/reviews-list';
import { Forbidden, PageTitle } from '@/components/admin/ui';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function AdminReviewsPage() {
  const locale = await getLocale();
  if (!(await adminPage('/admin/reviews', 'platform.support'))) return <Forbidden />;
  const [reviews, tz] = await Promise.all([listReviews(db(), null, 200), platformTimezone()]);
  return (
    <div className="space-y-4">
      <PageTitle title={text(locale, 'التقييمات', 'Ratings')} subtitle={text(locale, 'إخفاء التقييم المسيء بيشيله من المتوسط ومن المنيو، ويفضل محفوظ في السجل.', 'Hiding an abusive review removes it from averages and the menu; it stays on record.')} />
      <ReviewsList reviews={reviews} timezone={tz} showRestaurant canModerate orderHref={(id) => `/admin/orders/${id}`} />
    </div>
  );
}
