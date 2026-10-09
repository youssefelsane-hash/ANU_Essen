import { timingSafeEqual } from 'node:crypto';
import { lt, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { rateLimits, restaurants } from '@/server/db/schema';
import { log, sendAlert } from '@/server/log';
import { expireUnpaidOrders } from '@/server/services/order-actions';

export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Background housekeeping, called every few minutes by a scheduler (GitHub Actions / Vercel Cron)
 * with `Authorization: Bearer $CRON_SECRET`:
 * - cancels InstaPay orders whose payment window passed, even if nobody has a page open;
 * - removes expired rate-limit counters.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const started = Date.now();
  try {
    const list = await db().select({ id: restaurants.id, timeout: restaurants.unpaidTimeoutMinutes }).from(restaurants);
    let expired = 0;
    for (const r of list) expired += await expireUnpaidOrders(r.id, r.timeout);
    const pruned = await db().delete(rateLimits).where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`)).returning({ key: rateLimits.key });
    const result = { ok: true, restaurants: list.length, expired, prunedRateLimits: pruned.length, ms: Date.now() - started };
    log.info('cron_maintenance', result);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    await sendAlert(`Maintenance job failed: ${err instanceof Error ? err.message : String(err)}`, { where: 'cron' });
    throw err;
  }
}
