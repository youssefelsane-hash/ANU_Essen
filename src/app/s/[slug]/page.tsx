import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { loadPublicMenu } from '@/server/services/menu';
import { StoreMenu } from '@/components/customer/store-menu';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const menu = await loadPublicMenu(db(), (await params).slug);
  return { title: menu ? `${menu.restaurant.nameAr} — اطلب دلوقتي` : 'المحل غير موجود' };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const menu = await loadPublicMenu(db(), (await params).slug);
  if (!menu) notFound();
  return <StoreMenu menu={menu} />;
}
