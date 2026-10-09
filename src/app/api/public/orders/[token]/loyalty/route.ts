import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders, restaurants } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { json, route } from '@/server/http';
import { loyaltyForOrder } from '@/server/services/loyalty';

export const dynamic = 'force-dynamic';

/**
 * The customer's ELSANE card and prize codes at the order's restaurant. Bearer: the tracking token
 * saved on their phone (the menu and checkout use the latest one), never a phone number lookup.
 */
export const GET = route<{ params: Promise<{ token: string }> }>(async (_req, { params }) => {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  const [row] = await db().select({ o: orders, r: restaurants }).from(orders).innerJoin(restaurants, eq(restaurants.id, orders.restaurantId)).where(eq(orders.trackingToken, token));
  if (!row) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  return json({ slug: row.r.slug, loyalty: await loyaltyForOrder(db(), row.o, row.r) });
});
