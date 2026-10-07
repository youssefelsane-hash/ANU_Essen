import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/server/auth/session';
import { db } from '@/server/db';
import { restaurants } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { assertSameOrigin, json, readJson, route } from '@/server/http';
import { audit } from '@/server/services/audit';
import { getRestaurant, getStoreLive } from '@/server/services/store';

const bodySchema = z.object({ restaurantId: z.uuid(), status: z.enum(['OPEN', 'PAUSED', 'CLOSED']) });

export const POST = route(async (req, _ctx, meta) => {
  assertSameOrigin(req);
  const body = bodySchema.parse(await readJson(req, 10_000));
  const auth = await requirePermission('store.status', body.restaurantId);
  const before = await getRestaurant(db(), body.restaurantId);
  if (!before) throw new AppError('NOT_FOUND', 'Restaurant not found');
  const [updated] = await db()
    .update(restaurants)
    .set({ orderingStatus: body.status, updatedAt: new Date() })
    .where(eq(restaurants.id, body.restaurantId))
    .returning();
  await audit({
    actor: { type: 'USER', userId: auth.user.id, label: auth.user.name },
    action: 'store.status_changed',
    entity: 'restaurant',
    entityId: body.restaurantId,
    restaurantId: body.restaurantId,
    before: { orderingStatus: before.orderingStatus },
    after: { orderingStatus: body.status },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  const { config: _c, ...live } = await getStoreLive(db(), updated);
  return json({ store: live });
});
