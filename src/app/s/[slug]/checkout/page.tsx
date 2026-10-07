import type { Metadata } from 'next';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { loadPublicMenu } from '@/server/services/menu';
import { Checkout } from '@/components/customer/checkout';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const locale = await getLocale('customer');
  const menu = await loadPublicMenu(db(), (await params).slug);
  return { title: menu ? text(locale, 'تأكيد طلبك — ', 'Confirm order — ') + localizedName(locale, menu.restaurant.nameAr, menu.restaurant.nameEn) : text(locale, 'المطعم غير موجود', 'Restaurant not found'), robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const menu = await loadPublicMenu(db(), (await params).slug);
  if (!menu) notFound();
  return <Checkout key={menu.restaurant.id} menu={menu} />;
}
