import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders } from '@/server/db/schema';
import { CustomerShell } from '@/components/customer-shell';
import { NewTicketForm } from '@/components/support/new-ticket-form';
import { text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: text(await getLocale('customer'), 'الدعم والشكاوى', 'Support'), robots: { index: false } };
}

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const locale = await getLocale('customer');
  const raw = (await searchParams).order;
  const token = raw && /^[A-Za-z0-9_-]{16,64}$/.test(raw) ? raw : null;
  const [order] = token ? await db().select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.trackingToken, token)) : [];
  return (
    <CustomerShell locale={locale}>
      <section className="mx-auto max-w-2xl space-y-4 py-10">
        <h1 className="text-3xl font-bold">{text(locale, 'محتاج مساعدة؟', 'Need help?')}</h1>
        <p className="text-sm text-stone-600">{order ? text(locale, 'ابعتلنا المشكلة والمطعم وفريق المنصة هيشوفوها ويردوا عليك هنا.', 'Send us the problem; the restaurant and our team will see it and reply here.') : text(locale, 'لو المشكلة في طلب معين، افتح الطلب من «طلباتي» واضغط «في مشكلة؟» عشان يوصل للمطعم على طول.', 'If it is about a specific order, open it from “My orders” and tap “Problem?” so it reaches the restaurant directly.')}</p>
        <NewTicketForm orderToken={order ? token : null} orderNumber={order?.orderNumber ?? null} />
      </section>
    </CustomerShell>
  );
}
