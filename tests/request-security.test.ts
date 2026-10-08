import { describe, expect, it } from 'vitest';
import { safeLocalRedirect } from '@/lib/domain/safe-redirect';
import { assertSameOrigin } from '@/server/http';

describe('safe login destinations and cookie mutation origins', () => {
  it('allows local destinations while blocking browser-normalized external paths', () => {
    expect(safeLocalRedirect('/merchant/new-order?pickup=1')).toBe('/merchant/new-order?pickup=1');
    for (const path of ['//evil.example', '/\\evil.example', '\\evil.example', 'https://evil.example', '/\nevil.example', '/\u0000evil']) expect(safeLocalRedirect(path)).toBeNull();
  });
  it('requires the same scheme and port and rejects opaque or cross-site browser origins', () => {
    const request = (origin?: string, site?: string) => new Request('https://orders.example/api/merchant/orders', { method: 'POST', headers: { ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}) } });
    expect(() => assertSameOrigin(request('https://orders.example'))).not.toThrow();
    expect(() => assertSameOrigin(request())).not.toThrow();
    for (const origin of ['http://orders.example', 'https://orders.example:444', 'https://evil.example', 'null', 'https://orders.example/path']) expect(() => assertSameOrigin(request(origin))).toThrow();
    expect(() => assertSameOrigin(request(undefined, 'cross-site'))).toThrow();
  });
});
