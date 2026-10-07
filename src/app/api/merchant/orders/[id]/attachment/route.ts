import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/server/auth/session';
import { db } from '@/server/db';
import { orders, paymentAttachments, payments } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { route } from '@/server/http';

export const dynamic = 'force-dynamic';

/** The InstaPay screenshot uploaded by the customer (staff with payments.verify only). */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  const [order] = await db().select({ restaurantId: orders.restaurantId }).from(orders).where(eq(orders.id, id));
  if (!order) throw new AppError('NOT_FOUND', 'Order not found');
  await requirePermission('payments.verify', order.restaurantId);
  const [att] = await db()
    .select({ contentType: paymentAttachments.contentType, data: paymentAttachments.data })
    .from(paymentAttachments)
    .innerJoin(payments, eq(payments.id, paymentAttachments.paymentId))
    .where(eq(payments.orderId, id))
    .orderBy(desc(paymentAttachments.createdAt))
    .limit(1);
  if (!att) throw new AppError('NOT_FOUND', 'No screenshot');
  return new Response(new Uint8Array(att.data), {
    headers: { 'content-type': att.contentType, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' },
  });
});
