import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { loadPublicMenu } from '@/server/services/menu';
import { Checkout } from '@/components/customer/checkout';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const menu = await loadPublicMenu(db(), (await params).slug);
  return { title: menu ? 'تأكيد طلبك — ' + menu.restaurant.nameAr : 'المطعم غير موجود', robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const menu = await loadPublicMenu(db(), (await params).slug);
  if (!menu) notFound();
  return <Checkout key={menu.restaurant.id} menu={menu} />;
}
