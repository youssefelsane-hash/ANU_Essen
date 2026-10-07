import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { loadPublicMenu } from '@/server/services/menu';
import { Checkout } from '@/components/customer/checkout';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'تأكيد الطلب' };

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const menu = await loadPublicMenu(db(), (await params).slug);
  if (!menu) notFound();
  return <Checkout menu={menu} />;
}
