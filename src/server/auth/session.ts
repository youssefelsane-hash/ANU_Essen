import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from '../db';
import { sessions, users } from '../db/schema';
import { env, isProduction } from '../env';
import { AppError } from '../errors';
import { can, loadAuthz, type AuthContext } from './authz';

export const SESSION_COOKIE = 'sid';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomBytes(32).toString('base64url');
  const ttlMs = env().SESSION_TTL_DAYS * 86_400_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await db().insert(sessions).values({ id: sha256(token), userId, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** Current user + permissions, memoized per request. Sliding expiry keeps merchant tablets signed in. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const [row] = await db()
    .select({ sessionId: sessions.id, expiresAt: sessions.expiresAt, lastSeenAt: sessions.lastSeenAt, userId: users.id, name: users.name, email: users.email, isActive: users.isActive })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  if (!row || !row.isActive) return null;

  const ttlMs = env().SESSION_TTL_DAYS * 86_400_000;
  if (Date.now() - row.lastSeenAt.getTime() > 3_600_000) {
    const expiresAt = new Date(Date.now() + ttlMs);
    await db().update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, id));
    try {
      (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: isProduction(), sameSite: 'lax', path: '/', expires: expiresAt });
    } catch {
      /* cookies are read-only while rendering server components; the next API call refreshes it */
    }
  }
  return loadAuthz(db(), { id: row.userId, name: row.name, email: row.email });
});

/** For API routes / server actions. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Please sign in');
  return auth;
}

export async function requirePermission(permission: string, restaurantId?: string | null): Promise<AuthContext> {
  const auth = await requireAuth();
  if (!can(auth, permission, restaurantId)) throw new AppError('FORBIDDEN', 'You do not have permission for this action');
  return auth;
}

/** For pages: redirects to the login page instead of throwing. */
export async function pageAuth(nextPath: string): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return auth;
}
