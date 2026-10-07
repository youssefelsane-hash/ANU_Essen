import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { loadPublicMenu } from '@/server/services/menu';
import { StoreMenu } from '@/components/customer/store-menu';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const menu = await loadPublicMenu(db(), (await params).slug);
  if (!menu) return { title: 'المطعم غير موجود' };
  const description = menu.restaurant.taglineAr || 'اختار وجبتك من ' + menu.restaurant.nameAr + '، حدّد الاستلام والدفع وتابع تجهيز طلبك.';
  return {
    title: menu.restaurant.nameAr + ' — المنيو والطلب المباشر',
    description,
    openGraph: {
      title: menu.restaurant.nameAr,
      description,
      locale: 'ar_EG',
      type: 'website',
      ...(menu.restaurant.coverImageUrl ? { images: [menu.restaurant.coverImageUrl] } : {}),
    },
  };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const menu = await loadPublicMenu(db(), (await params).slug);
  if (!menu) notFound();
  return <StoreMenu key={menu.restaurant.id} menu={menu} />;
}
