import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { json, route } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Readiness: the database answers. */
export const GET = route(async () => {
  const started = Date.now();
  try {
    await db().execute(sql`select 1`);
    return json({ status: 'ready', db: 'ok', dbLatencyMs: Date.now() - started });
  } catch {
    return json({ status: 'not_ready', db: 'error' }, { status: 503 });
  }
});
