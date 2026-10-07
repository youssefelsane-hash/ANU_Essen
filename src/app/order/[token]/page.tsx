import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { loadTrackingView } from '@/server/services/order-views';
import { Tracking } from '@/components/customer/tracking';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'متابعة الطلب', robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const view = await loadTrackingView(db(), token);
  if (!view) notFound();
  return <Tracking initial={view} token={token} />;
}
