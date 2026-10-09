import { eq } from 'drizzle-orm';
import { db } from './db';
import { systemSettings } from './db/schema';
import { pageAuth } from './auth/session';
import { can } from './auth/authz';

/** For admin pages: signed-in user holding `permission` (or any of several), or null (page renders a 403 message). */
export async function adminPage(path: string, permission: string | string[]) {
  const auth = await pageAuth(path);
  return (Array.isArray(permission) ? permission : [permission]).some((p) => can(auth, p)) ? auth : null;
}

/** First admin section a (possibly limited) platform employee may open. */
export function firstAdminSection(auth: Parameters<typeof can>[0]): string {
  const sections: [string, string][] = [
    ['/admin/support', 'platform.support'], ['/admin/restaurants', 'platform.restaurants'], ['/admin/orders', 'orders.view'],
    ['/admin/finance', 'platform.finance'], ['/admin/users', 'platform.users'], ['/admin/audit', 'platform.audit'], ['/admin/settings', 'platform.settings'],
  ];
  return sections.find(([, p]) => can(auth, p))?.[0] ?? '/merchant';
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db().select().from(systemSettings).where(eq(systemSettings.key, key));
  return (row?.value as T | undefined) ?? fallback;
}

export const platformTimezone = () => getSetting('platform.timezone', 'Africa/Cairo');
