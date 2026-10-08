import { requireAuth } from '@/server/auth/session';
import { assertRequestActor } from '@/server/auth/request-identity';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { assertSameOrigin, json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { createCounterOrder } from '@/server/services/checkout';
import { loadOrderSnapshots } from '@/server/services/order-views';
import { hasPermission } from '@/lib/domain/permissions';
import { counterOrderSchema, idempotencyKeySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Counter (walk-in) order created by staff. Requires `orders.create` in that restaurant, a same-origin
 * request and an Idempotency-Key, so a double tap on a slow connection records one order only.
 */
export const POST = route(async (req, _ctx, meta) => {
  assertSameOrigin(req);
  const auth = await requireAuth();
  const input = await readJson(req, 50_000);
  assertRequestActor(auth, input && typeof input === 'object' ? (input as Record<string, unknown>).actorUserId : undefined);
  const key = idempotencyKeySchema.safeParse(req.headers.get('idempotency-key'));
  if (!key.success) throw new AppError('VALIDATION', 'Missing or invalid Idempotency-Key header');
  // actorUserId is transport metadata, deliberately outside the canonical persisted order body.
  const body = counterOrderSchema.parse(input);
  if (!hasPermission(auth, 'orders.create', body.restaurantId)) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
  await enforceRateLimit(`counter:${auth.user.id}`, 300, 600);

  const created = await createCounterOrder(body.restaurantId, body, key.data, {
    userId: auth.user.id,
    name: auth.user.name,
    auth,
    deviceId: body.deviceId ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  const [order] = await loadOrderSnapshots(db(), [created.orderId], { includePhone: true });
  return json({ ...created, order, viewerUserId: auth.user.id }, { status: created.replayed ? 200 : 201 });
});
