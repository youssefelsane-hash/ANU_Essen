import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/server/errors';
import { assertSameOrigin, json, readJson, route } from '@/server/http';
import { requirePermission } from '@/server/auth/session';
import { enforceRateLimit } from '@/server/rate-limit';
import { getRestaurant } from '@/server/services/store';
import { db } from '@/server/db';
import { createOrder } from '@/server/services/checkout';
import { createOrderSchema, idempotencyKeySchema, quoteSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const counterSchema = quoteSchema.extend({
  restaurantId: z.uuid(),
  customerName: z.string().trim().max(60).optional(),
  customerPhone: z.string().trim().max(20).nullish(),
  note: z.string().trim().max(300).nullish(),
  paymentMethod: createOrderSchema.shape.paymentMethod,
  cashReceived: z.boolean().default(false),
});

/** Authenticated staff entry. Prices, attribution and initial status are never accepted from the browser. */
export const POST = route(async (req, _ctx, meta) => {
  assertSameOrigin(req);
  const input = counterSchema.parse(await readJson(req, 50_000));
  const auth = await requirePermission('orders.accept', input.restaurantId);
  const key = idempotencyKeySchema.safeParse(req.headers.get('idempotency-key'));
  if (!key.success) throw new AppError('VALIDATION', 'Missing or invalid Idempotency-Key header');
  await enforceRateLimit(`counter:user:${auth.user.id}`, 600, 600);
  const restaurant = await getRestaurant(db(), input.restaurantId);
  if (!restaurant) throw new AppError('NOT_FOUND', 'Restaurant not found');
  const body = createOrderSchema.parse({
    ...input,
    customerName: input.customerName || 'عميل المحل',
    source: 'counter',
  });
  // A guest request or another staff member cannot share this idempotency namespace.
  const staffKey = `counter:${createHash('sha256').update(`${auth.user.id}:${key.data}`).digest('hex')}`;
  const created = await createOrder(restaurant.slug, body, staffKey, new Date(), undefined, {
    staff: { userId: auth.user.id, label: auth.user.name, auth, ip: meta.ip, userAgent: meta.userAgent },
    cashReceived: input.cashReceived,
  });
  return json(created, { status: created.replayed ? 200 : 201 });
});
