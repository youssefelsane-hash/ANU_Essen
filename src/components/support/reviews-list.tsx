import Link from 'next/link';
import { formatDateTime } from '@/lib/domain/misc';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import type { listReviews } from '@/server/services/reviews';
import { ReviewActions } from './review-actions';

export async function ReviewsList({ reviews, timezone, showRestaurant, canModerate, orderHref }: { reviews: Awaited<ReturnType<typeof listReviews>>; timezone: string; showRestaurant: boolean; canModerate: boolean; orderHref: (id: string) => string }) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!reviews.length) return <p className="card text-sm text-gray-500">{t('لسه مفيش تقييمات. التقييم بيظهر للعميل بعد ما الطلب يتسلم.', 'No ratings yet. Customers can rate after their order is delivered.')}</p>;
  const visible = reviews.filter((r) => !r.isHidden);
  const avg = visible.length ? visible.reduce((s, r) => s + r.rating, 0) / visible.length : 0;
  return (
    <div className="space-y-3">
      <p className="card text-sm">{t('متوسط آخر ', 'Average of the last ')}{visible.length}{t(' تقييم: ', ' ratings: ')}<b className="text-amber-700">★ {avg.toFixed(1)}</b></p>
      {reviews.map((r) => (
        <article key={r.id} className={`card space-y-2 ${r.isHidden ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span><b className="text-amber-600">{'★'.repeat(r.rating)}<span className="text-gray-300">{'★'.repeat(5 - r.rating)}</span></b> · {r.customerName}{showRestaurant && <> · {localizedName(locale, r.restaurantNameAr, r.restaurantNameEn)}</>} · <Link className="text-blue-700" href={orderHref(r.orderId)} dir="ltr">#{r.orderNumber}</Link></span>
            <span className="text-xs text-gray-500">{formatDateTime(r.createdAt, timezone, locale)}{r.isHidden && <> · {t('مخفي', 'Hidden')}</>}</span>
          </div>
          {r.comment && <p className="text-sm">{r.comment}</p>}
          <ReviewActions reviewId={r.id} reply={r.reply} isHidden={r.isHidden} canModerate={canModerate} />
        </article>
      ))}
    </div>
  );
}
