import { notFound } from 'next/navigation';
import { z } from 'zod';
import { merchantContext } from '@/server/merchant-context';
import { ticketForStaff } from '@/server/services/support';
import { TicketView } from '@/components/support/staff-support';

export const dynamic = 'force-dynamic';

export default async function MerchantTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { auth, restaurant, permissions } = await merchantContext(`/merchant/support/${id}`);
  if (!restaurant || !permissions.has('support.manage')) notFound();
  const thread = await ticketForStaff(id, auth);
  if (!thread || thread.ticket.restaurantId !== restaurant.id) notFound();
  return (
    <main className="p-4">
      <TicketView thread={thread} timezone={restaurant.timezone} orderHref={thread.ticket.orderId ? `/merchant/orders/${thread.ticket.orderId}` : null} backHref="/merchant/support" />
    </main>
  );
}
