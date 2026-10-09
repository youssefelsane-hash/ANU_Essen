import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { json, route } from '@/server/http';
import { loadTrackingView } from '@/server/services/order-views';

export const dynamic = 'force-dynamic';

/**
 * Order tracking. Pages poll every few seconds, so `?v=<version>` makes a poll cost one tiny query
 * when nothing changed. Unpaid orders always load fully (the payment timeout runs on read).
 */
export const GET = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  const known = Number(new URL(req.url).searchParams.get('v'));
  if (Number.isInteger(known) && known > 0) {
    const [row] = await db().select({ version: orders.version, status: orders.status }).from(orders).where(eq(orders.trackingToken, token));
    if (!row) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
    if (row.version === known && row.status !== 'AWAITING_PAYMENT') return json({ unchanged: true, serverTime: Date.now() });
  }
  const view = await loadTrackingView(db(), token);
  if (!view) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  return json(view);
});
