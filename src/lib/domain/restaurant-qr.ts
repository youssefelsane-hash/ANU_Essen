import { z } from 'zod';

export const RESTAURANT_QR_OPTIONS = {
  margin: 4,
  errorCorrectionLevel: 'M' as const,
  color: { dark: '#000000', light: '#ffffff' },
};

export function publicOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter the public address with https:// (for example, https://your-domain.com).');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the website origin only, without a path, password, query or fragment.');
  }
  return url.origin;
}

/** Restaurant IDs stay stable when the owner changes the display name or menu slug. */
export function buildRestaurantQrUrl(baseUrl: string, restaurantId: string, source = ''): string {
  if (!z.uuid().safeParse(restaurantId).success) throw new Error('Invalid restaurant ID.');
  const poster = source.trim();
  if (poster && !/^[a-zA-Z0-9_-]{1,64}$/.test(poster)) throw new Error('Poster label: use up to 64 letters, numbers, dashes or underscores.');
  const url = new URL(`/q/${restaurantId}`, publicOrigin(baseUrl));
  if (poster) url.searchParams.set('utm_source', poster);
  return url.toString();
}

export function isLocalQrOrigin(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname;
    return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(hostname) || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}
