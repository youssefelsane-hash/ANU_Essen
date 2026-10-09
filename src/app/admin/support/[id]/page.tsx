import { notFound } from 'next/navigation';
import { z } from 'zod';
import { adminPage, platformTimezone } from '@/server/admin-guard';
import { ticketForStaff } from '@/server/services/support';
import { TicketView } from '@/components/support/staff-support';
import { Forbidden } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await adminPage(`/admin/support/${id}`, 'platform.support');
  if (!auth) return <Forbidden />;
  const thread = await ticketForStaff(id, auth);
  if (!thread) notFound();
  return <TicketView thread={thread} timezone={await platformTimezone()} orderHref={thread.ticket.orderId ? `/admin/orders/${thread.ticket.orderId}` : null} backHref="/admin/support" />;
}
