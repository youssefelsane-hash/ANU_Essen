import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { merchantContext } from '@/server/merchant-context';
import { listReviews } from '@/server/services/reviews';
import { ReviewsList } from '@/components/support/reviews-list';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function MerchantReviewsPage() {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { restaurant, permissions } = await merchantContext('/merchant/reviews');
  if (!restaurant || !(permissions.has('support.manage') || permissions.has('reports.view'))) notFound();
  const reviews = await listReviews(db(), restaurant.id);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black">{t('تقييمات العملاء', 'Customer ratings')}</h1>
          <p className="text-sm text-gray-600">{t('العميل بيقيّم بعد ما يستلم. ردك بيظهر تحت التقييم في المنيو.', 'Customers rate after delivery. Your reply appears under the review on the menu.')}</p>
        </div>
        {permissions.has('support.manage') && <Link href="/merchant/support" className="btn btn-secondary btn-sm">{t('الشكاوى', 'Complaints')}</Link>}
      </div>
      <ReviewsList reviews={reviews} timezone={restaurant.timezone} showRestaurant={false} canModerate={false} orderHref={(id) => `/merchant/orders/${id}`} />
    </main>
  );
}
