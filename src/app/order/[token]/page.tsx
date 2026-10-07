import type { Metadata } from 'next';
import { text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { loadTrackingView } from '@/server/services/order-views';
import { Tracking } from '@/components/customer/tracking';
import { SiteFooter } from '@/components/site-footer';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale('customer');
  return { title: text(locale, 'متابعة الطلب', 'Track your order'), robots: { index: false } };
}

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const view = await loadTrackingView(db(), token);
  if (!view) notFound();
  return (
    <>
      <Tracking initial={view} token={token} />
      <SiteFooter locale={await getLocale('customer')} />
    </>
  );
}
