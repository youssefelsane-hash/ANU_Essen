import { z } from 'zod';
import { requireAuth } from '@/server/auth/session';
import { assertRequestActor } from '@/server/auth/request-identity';
import { AppError } from '@/server/errors';
import { assertSameOrigin, json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { quoteCounterOrder } from '@/server/services/checkout';
import { quoteSchema } from '@/lib/validation';
import { hasPermission } from '@/lib/domain/permissions';

export const dynamic = 'force-dynamic';
const schema = quoteSchema.extend({ restaurantId: z.uuid() });

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const auth = await requireAuth();
  const raw = await readJson(req, 50_000);
  assertRequestActor(auth, raw && typeof raw === 'object' ? (raw as Record<string, unknown>).actorUserId : undefined);
  const input = schema.parse(raw);
  if (!hasPermission(auth, 'orders.create', input.restaurantId)) throw new AppError('FORBIDDEN');
  await enforceRateLimit(`counter-quote:${auth.user.id}`, 600, 60);
  return json({ ...await quoteCounterOrder(input.restaurantId, input, auth), viewerUserId: auth.user.id });
});
