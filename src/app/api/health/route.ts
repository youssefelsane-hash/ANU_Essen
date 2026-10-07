import { json, route } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Liveness: the process is up. */
export const GET = route(async () => json({ status: 'ok', time: new Date().toISOString() }));
