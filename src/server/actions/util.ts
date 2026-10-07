import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { reportError } from '../log';
import type { ActionState } from '../../lib/action-state';
import { PricingError } from '../../lib/domain/pricing';
import { getLocale } from '../../lib/i18n/server';
import { errorMessage, localizeMessage, text } from '../../lib/i18n';

/** Uniform server-action wrapper: returns a message instead of crashing the page. */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionState> {
  const locale = await getLocale('staff');
  try {
    const message = await fn();
    return { ok: true, message: localizeMessage(message ?? 'Saved', locale), at: Date.now() };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError || err instanceof PricingError) return { ok: false, error: errorMessage(err.code, locale, err.message), at: Date.now() };
    if (err instanceof ZodError) {
      return { ok: false, error: text(locale, 'راجع الحقول المطلوبة والقيم المكتوبة وحاول تاني.', 'Check the required fields and entered values, then try again.'), at: Date.now() };
    }
    reportError(err, { where: 'server-action' });
    return { ok: false, error: errorMessage('INTERNAL', locale), at: Date.now() };
  }
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip'),
    userAgent: h.get('user-agent'),
  };
}

/** FormData helpers */
export const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};
export const optStr = (fd: FormData, key: string) => str(fd, key) || null;
export const bool = (fd: FormData, key: string) => fd.get(key) === 'on' || fd.get(key) === 'true';
export const int = (fd: FormData, key: string, fallback = 0) => {
  const n = Number(str(fd, key));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
export function json<T>(fd: FormData, key: string): T {
  try {
    return JSON.parse(str(fd, key) || 'null') as T;
  } catch {
    throw new AppError('VALIDATION', `Invalid ${key}`);
  }
}
