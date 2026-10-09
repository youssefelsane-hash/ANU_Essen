import { z } from 'zod';
import { requireAuth } from '@/server/auth/session';
import { assertRequestActor } from '@/server/auth/request-identity';
import { db } from '@/server/db';
import { json, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { courierCashReport } from '@/server/services/couriers';

export const dynamic = 'force-dynamic';

/** The report service scopes both the restaurant grant and the courier identity. */
export const GET = route(async (req) => {
  const auth = await requireAuth();
  const query = new URL(req.url).searchParams;
  assertRequestActor(auth, query.get('actorUserId'));
  const restaurantId = z.uuid().parse(query.get('restaurantId'));
  await enforceRateLimit(`delivery-summary:${auth.user.id}`, 600, 60);
  return json({ ...await courierCashReport(db(), auth, restaurantId), viewerUserId: auth.user.id });
});
