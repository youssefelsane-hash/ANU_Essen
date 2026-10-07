import { eq } from 'drizzle-orm';
import { db } from './db';
import { systemSettings } from './db/schema';
import { pageAuth } from './auth/session';
import { can } from './auth/authz';

/** For admin pages: signed-in user holding `permission`, or null (page renders a 403 message). */
export async function adminPage(path: string, permission: string) {
  const auth = await pageAuth(path);
  return can(auth, permission) ? auth : null;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db().select().from(systemSettings).where(eq(systemSettings.key, key));
  return (row?.value as T | undefined) ?? fallback;
}

export const platformTimezone = () => getSetting('platform.timezone', 'Africa/Cairo');
