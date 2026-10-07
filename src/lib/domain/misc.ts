/** Human-friendly order numbers: A100…A999, B100…, Z999, then wraps. Display only — never an ID. */
export function formatOrderNumber(seq: number): string {
  const idx = Math.max(0, seq - 100);
  const letter = String.fromCharCode(65 + (Math.floor(idx / 900) % 26));
  return `${letter}${100 + (idx % 900)}`;
}

/** Normalizes Egyptian mobile numbers to 01XXXXXXXXX; returns null when invalid. */
export function normalizeEgyptianPhone(input: string): string | null {
  const digits = input
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\d+]/g, '');
  let local = digits;
  if (local.startsWith('+20')) local = '0' + local.slice(3);
  else if (local.startsWith('0020')) local = '0' + local.slice(4);
  else if (local.startsWith('20') && local.length === 12) local = '0' + local.slice(2);
  return /^01[0125]\d{8}$/.test(local) ? local : null;
}

export function formatMoney(piasters: number, locale: 'ar' | 'en' = 'ar'): string {
  const v = piasters / 100;
  const s = Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return locale === 'ar' ? `${s} ج.م` : `${s} EGP`;
}

/** Parses an EGP amount typed by an admin ("85", "85.5") into piasters. */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const n = typeof input === 'number' ? input : Number(String(input).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function formatTime(date: Date | string | number, timeZone: string, locale: 'ar' | 'en' = 'ar'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string | number, timeZone: string, locale: 'ar' | 'en' = 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(date));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Only same-site paths are allowed as post-login destinations. Browsers treat "/\evil.com" like
 * "//evil.com", so a prefix check is not enough: resolve it and require the same origin.
 */
export function safeInternalPath(next: string | null | undefined): string | null {
  if (!next || next.length > 512 || !next.startsWith('/') || /[\\\u0000-\u001f]/.test(next)) return null;
  try {
    const base = 'http://internal.invalid';
    const url = new URL(next, base);
    if (url.origin !== base) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
