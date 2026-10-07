import { destroySession } from '@/server/auth/session';
import { assertSameOrigin, json, route } from '@/server/http';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  await destroySession();
  return json({ ok: true });
});
