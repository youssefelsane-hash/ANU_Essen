import { lt, sql } from 'drizzle-orm';
import { db } from './db';
import { rateLimits } from './db/schema';
import { AppError } from './errors';

/**
 * Fixed-window rate limiter stored in Postgres — works across serverless instances without Redis.
 * Swap for Upstash/Redis if traffic ever needs it; callers only use `enforceRateLimit`.
 */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; count: number }> {
  const expired = sql`${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds})`;
  const [row] = await db()
    .insert(rateLimits)
    .values({ key, windowStart: new Date(), count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });
  if (Math.random() < 0.01) {
    await db().delete(rateLimits).where(lt(rateLimits.windowStart, new Date(Date.now() - 24 * 3600_000)));
  }
  return { allowed: row.count <= limit, count: row.count };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const { allowed } = await hitRateLimit(key, limit, windowSeconds);
  if (!allowed) throw new AppError('RATE_LIMITED', 'طلبات كتير في وقت قصير، استنى شوية وحاول تاني');
}
