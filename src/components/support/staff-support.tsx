import Link from 'next/link';
import { formatDateTime } from '@/lib/domain/misc';
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS } from '@/lib/domain/support-labels';
import { localizedName, text } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import type { listTickets, TicketThread } from '@/server/services/support';
import { StaffTicketActions } from './staff-ticket-actions';

const STATUS_TONE: Record<string, string> = { OPEN: 'bg-amber-100 text-amber-800', ANSWERED: 'bg-emerald-50 text-emerald-700', CLOSED: 'bg-gray-100 text-gray-600' };

export async function TicketInbox({ tickets, basePath, timezone, showRestaurant }: { tickets: Awaited<ReturnType<typeof listTickets>>; basePath: string; timezone: string; showRestaurant: boolean }) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  if (!tickets.length) return <p className="card text-sm text-gray-500">{t('مفيش شكاوى دلوقتي. 👌', 'No support requests right now. 👌')}</p>;
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>{t('الرقم', 'Code')}</th><th>{t('الحالة', 'Status')}</th><th>{t('النوع', 'Type')}</th>{showRestaurant && <th>{t('المطعم', 'Restaurant')}</th>}<th>{t('العميل', 'Customer')}</th><th>{t('أول رسالة', 'First message')}</th><th>{t('آخر نشاط', 'Last activity')}</th></tr></thead>
        <tbody>
          {tickets.map((x) => (
            <tr key={x.id}>
              <td><Link className="font-bold text-blue-700" href={`${basePath}/${x.id}`} dir="ltr">{x.code}</Link>{x.orderNumber && <div className="text-xs text-gray-500" dir="ltr">#{x.orderNumber}</div>}</td>
              <td><span className={`badge ${STATUS_TONE[x.status]}`}>{t(...TICKET_STATUS_LABELS[x.status])}</span></td>
              <td className="text-sm">{t(...TICKET_CATEGORY_LABELS[x.category])}</td>
              {showRestaurant && <td className="text-sm">{x.restaurantNameAr ? localizedName(locale, x.restaurantNameAr, x.restaurantNameEn) : t('المنصة', 'Platform')}</td>}
              <td className="text-sm">{x.customerName}</td>
              <td className="max-w-xs truncate text-sm">{x.subject}</td>
              <td className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(x.lastMessageAt, timezone, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function TicketView({ thread, timezone, orderHref, backHref }: { thread: TicketThread; timezone: string; orderHref: string | null; backHref: string }) {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { ticket, messages } = thread;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={backHref} className="text-sm text-blue-700">{t('← كل الشكاوى', '← All requests')}</Link>
      <div className="card space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-black" dir="ltr">{ticket.code}</h1>
          <span className={`badge ${STATUS_TONE[ticket.status]}`}>{t(...TICKET_STATUS_LABELS[ticket.status])}</span>
        </div>
        <p className="text-sm text-gray-600">{t(...TICKET_CATEGORY_LABELS[ticket.category])}{ticket.restaurantNameAr && <> · {localizedName(locale, ticket.restaurantNameAr, ticket.restaurantNameEn)}</>}</p>
        <p className="text-sm">{ticket.customerName}{ticket.customerPhone && <> · <a className="text-blue-700" href={`tel:${ticket.customerPhone}`} dir="ltr">{ticket.customerPhone}</a></>}{ticket.orderNumber && orderHref && <> · <Link className="text-blue-700" href={orderHref}>{t('الطلب ', 'Order ')}<span dir="ltr">#{ticket.orderNumber}</span></Link></>}</p>
      </div>
      <ol className="space-y-3">
        {messages.map((m) => (
          <li key={m.id} className={`rounded-2xl border p-4 text-sm leading-7 ${m.authorType === 'CUSTOMER' ? 'me-8 border-gray-200 bg-white' : 'ms-8 border-emerald-100 bg-emerald-50'}`}>
            <div className="mb-1 flex justify-between gap-2 text-xs text-gray-500"><b>{m.authorType === 'CUSTOMER' ? t('العميل', 'Customer') : m.authorName ?? t('الفريق', 'Team')}</b><span>{formatDateTime(m.createdAt, timezone, locale)}</span></div>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      <StaffTicketActions ticketId={ticket.id} status={ticket.status} />
      <p className="text-xs text-gray-500">{t('العميل بيشوف ردك في صفحة الشكوى (اسمك مش بيظهر له). لو المشكلة محتاجة فلوس ترجع، سجّل الاسترداد من صفحة الطلب.', 'The customer sees your reply on their request page (your name is not shown). If money must go back, record a refund on the order page.')}</p>
    </div>
  );
}
