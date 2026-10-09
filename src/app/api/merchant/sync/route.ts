import { requireAuth } from '@/server/auth/session';
import { assertRequestActor } from '@/server/auth/request-identity';
import { json, route } from '@/server/http';
import { merchantSync } from '@/server/services/sync';
import { syncQuerySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = route(async (req, _ctx, meta) => {
  const auth = await requireAuth();
  const query = new URL(req.url).searchParams;
  assertRequestActor(auth, query.get('actorUserId'));
  const q = syncQuerySchema.parse(Object.fromEntries(query));
  const result = await merchantSync({ auth, restaurantId: q.restaurantId, deviceId: q.deviceId, cursor: q.cursor, userAgent: meta.userAgent });
  return json({ ...result, viewerUserId: auth.user.id });
});
