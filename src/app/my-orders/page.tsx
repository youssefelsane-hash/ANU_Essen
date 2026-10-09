import type { Metadata } from 'next';
import { MyOrders, MyTickets } from '@/components/customer/my-orders';
import { CustomerShell } from '@/components/customer-shell';
import { text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: text(await getLocale('customer'), 'طلباتي', 'My orders'), robots: { index: false } };
}

export default async function MyOrdersPage() {
  const locale = await getLocale('customer');
  return (
    <CustomerShell locale={locale}>
      <section className="mx-auto max-w-2xl py-10">
        <h1 className="text-3xl font-bold">{text(locale, 'طلباتي', 'My orders')}</h1>
        <p className="mb-6 mt-2 text-sm text-stone-500">{text(locale, 'آخر ١٠ طلبات من الموبايل ده. افتح أي طلب عشان تتابعه أو تطلبه تاني أو تطلب استرجاع.', 'Your last 10 orders from this phone. Open one to track it, order it again or ask for a refund.')}</p>
        <MyOrders />
        <MyTickets />
      </section>
    </CustomerShell>
  );
}
