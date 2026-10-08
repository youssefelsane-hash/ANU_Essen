import { describe, expect, it } from 'vitest';
import { assertSameOrigin } from '@/server/http';
import { AppError } from '@/server/errors';

describe('cookie mutation origin security', () => {
  const request = (origin?: string, headers: Record<string, string> = {}) => new Request('https://orders.example/api/merchant/orders', { method: 'POST', headers: { host: 'orders.example', ...(origin ? { origin } : {}), ...headers } });
  it('accepts matching browser origins and non-browser requests without an Origin', () => {
    expect(() => assertSameOrigin(request('https://orders.example'))).not.toThrow();
    expect(() => assertSameOrigin(request())).not.toThrow();
  });
  it.each(['http://orders.example', 'https://orders.example:8443', 'https://evil.example', 'null', 'https://orders.example/path', 'https://user@orders.example'])('rejects an invalid origin %s', (origin) => {
    expect(() => assertSameOrigin(request(origin))).toThrow(AppError);
  });
  it('does not trust a caller-supplied forwarded host or an explicitly cross-site browser request', () => {
    expect(() => assertSameOrigin(request('https://evil.example', { 'x-forwarded-host': 'evil.example' }))).toThrow(AppError);
    expect(() => assertSameOrigin(request(undefined, { 'sec-fetch-site': 'cross-site' }))).toThrow(AppError);
  });
});
