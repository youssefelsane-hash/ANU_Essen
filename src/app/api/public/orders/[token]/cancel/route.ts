import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { json, route } from '@/server/http';
import { applyOrderAction } from '@/server/services/order-actions';

export const dynamic = 'force-dynamic';

/** Customer cancels before paying (allowed only in CREATED / AWAITING_PAYMENT by the state machine). */
export const POST = route<{ params: Promise<{ token: string }> }>(async (_req, { params }, meta) => {
  const { token } = await params;
  const [order] = await db().select({ id: orders.id }).from(orders).where(eq(orders.trackingToken, token));
  if (!order) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  const result = await applyOrderAction({
    orderId: order.id,
    action: 'CANCEL',
    actor: { type: 'CUSTOMER', label: 'customer', ip: meta.ip, userAgent: meta.userAgent },
  });
  return json({ status: result.status });
});
