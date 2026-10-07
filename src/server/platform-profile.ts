import { eq } from 'drizzle-orm';
import { db } from './db';
import { systemSettings } from './db/schema';
import { resolvePlatformProfile, type PlatformProfile } from '../lib/domain/platform-profile';

export const PLATFORM_PROFILE_KEY = 'platform.profile';

/** Public platform identity. Never throws: a missing / broken setting falls back to the defaults. */
export async function getPlatformProfile(): Promise<PlatformProfile> {
  try {
    const [row] = await db().select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, PLATFORM_PROFILE_KEY));
    return resolvePlatformProfile(row?.value);
  } catch {
    return resolvePlatformProfile(null);
  }
}
