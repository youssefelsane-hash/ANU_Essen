import type { Metadata } from 'next';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { loadPublicMenu } from '@/server/services/menu';
import { memo } from '@/server/cache';
import { StoreMenu } from '@/components/customer/store-menu';
import { SiteFooter } from '@/components/site-footer';
import { getPlatformProfile } from '@/server/platform-profile';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const locale = await getLocale('customer');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const menu = await loadPublicMenu(db(), (await params).slug);
  if (!menu) return { title: t('المطعم غير موجود', 'Restaurant not found') };
  const name = localizedName(locale, menu.restaurant.nameAr, menu.restaurant.nameEn);
  const description = localizedName(locale, menu.restaurant.taglineAr, menu.restaurant.taglineEn) || t('اختار وجبتك من ' + name + '، حدّد الاستلام والدفع وتابع تجهيز طلبك.', 'Choose your meal from ' + name + ', arrange pickup and payment, and track your order.');
  return {
    title: name + t(' — المنيو والطلب المباشر', ' — Menu and direct ordering'),
    description,
    openGraph: {
      title: name,
      description,
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      alternateLocale: locale === 'ar' ? ['en_US'] : ['ar_EG'],
      type: 'website',
      ...(menu.restaurant.coverImageUrl ? { images: [menu.restaurant.coverImageUrl] } : {}),
    },
  };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const [menu, profile, locale] = await Promise.all([memo(`menu:${slug.toLowerCase()}`, 5_000, () => loadPublicMenu(db(), slug)), memo('platform-profile', 30_000, getPlatformProfile), getLocale('customer')]);
  if (!menu) notFound();
  return (
    <>
      <StoreMenu key={menu.restaurant.id} menu={menu} orderAhead={{ ar: profile.orderAheadAr, en: profile.orderAheadEn }} />
      <SiteFooter locale={locale} className="with-cart-bar" />
    </>
  );
}
