import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerShell } from '@/components/customer-shell';
import { TicketReplyForm } from '@/components/support/new-ticket-form';
import { ticketByToken } from '@/server/services/support';
import { formatDateTime } from '@/lib/domain/misc';
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS } from '@/lib/domain/support-labels';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: text(await getLocale('customer'), 'متابعة الشكوى', 'Your support request'), robots: { index: false } };
}

export default async function TicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const thread = await ticketByToken(token);
  if (!thread) notFound();
  const locale = await getLocale('customer');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { ticket, messages } = thread;
  return (
    <CustomerShell locale={locale}>
      <section className="mx-auto max-w-2xl space-y-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">{t('شكوى رقم ', 'Request ')}<span dir="ltr">{ticket.code}</span></h1>
          <span className="badge bg-stone-100 text-stone-700">{t(...TICKET_STATUS_LABELS[ticket.status])}</span>
        </div>
        <p className="text-sm text-stone-600">
          {t(...TICKET_CATEGORY_LABELS[ticket.category])}
          {ticket.restaurantNameAr && <> · {localizedName(locale, ticket.restaurantNameAr, ticket.restaurantNameEn)}</>}
          {ticket.orderNumber && ticket.orderToken && <> · <Link className="underline" href={`/order/${ticket.orderToken}`}>{t('طلب ', 'order ')}<span dir="ltr">#{ticket.orderNumber}</span></Link></>}
        </p>
        <ol className="space-y-3">
          {messages.map((m) => (
            <li key={m.id} className={`rounded-2xl p-4 text-sm leading-7 ${m.authorType === 'CUSTOMER' ? 'ms-8 bg-white border border-stone-200' : 'me-8 bg-emerald-50 border border-emerald-100'}`}>
              <div className="mb-1 flex justify-between gap-2 text-xs text-stone-500"><b>{m.authorType === 'CUSTOMER' ? t('انت', 'You') : t('فريق الدعم', 'Support team')}</b><span>{formatDateTime(m.createdAt, 'Africa/Cairo', locale)}</span></div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
        <div className="card">
          {ticket.status === 'CLOSED' && <p className="mb-2 text-xs text-stone-500">{t('الشكوى اتقفلت. لو المشكلة لسه موجودة اكتب هنا وهتتفتح تاني.', 'This request is closed. If the problem continues, write here and it reopens.')}</p>}
          <TicketReplyForm token={token} />
        </div>
        <p className="text-xs text-stone-500">{t('احفظ الصفحة دي؛ أي حد معاه الرابط يقدر يشوف المحادثة.', 'Keep this page; anyone with the link can see the conversation.')}</p>
      </section>
    </CustomerShell>
  );
}
