import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/errors';

const mock = vi.hoisted(() => ({ userId: '', allowed: true, create: vi.fn(), quote: vi.fn(), snapshots: vi.fn(), rate: vi.fn(), db: vi.fn() }));
const restaurantId = '20000000-0000-4000-8000-000000000001';
vi.mock('@/server/auth/session', () => ({ requireAuth: async () => {
  if (!mock.userId) throw new AppError('UNAUTHENTICATED');
  return { user: { id: mock.userId, name: 'Current cashier', email: 'cashier@example.test' }, platformPermissions: new Set(), storePermissions: new Map([[restaurantId, new Set(mock.allowed ? ['orders.create'] : [])]]) };
} }));
vi.mock('@/server/services/checkout', () => ({ createCounterOrder: mock.create, quoteCounterOrder: mock.quote }));
vi.mock('@/server/services/order-views', () => ({ loadOrderSnapshots: mock.snapshots }));
vi.mock('@/server/rate-limit', () => ({ enforceRateLimit: mock.rate }));
vi.mock('@/server/db', () => ({ db: mock.db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }, reportError: vi.fn() }));

import { POST as create } from '@/app/api/merchant/orders/route';
import { POST as quote } from '@/app/api/merchant/orders/quote/route';

const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
const productId = '30000000-0000-4000-8000-000000000001';
const orderId = '40000000-0000-4000-8000-000000000001';
type Endpoint = 'create' | 'quote';
const canonical = { restaurantId, items: [{ productId, quantity: 1, addonIds: [] }], paymentMethod: 'CASH' };
function call(endpoint: Endpoint, actorUserId: unknown) {
  const request = new Request(`http://localhost/api/merchant/orders${endpoint === 'quote' ? '/quote' : ''}`, {
    method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', 'idempotency-key': 'old-persisted-counter-key' },
    body: JSON.stringify({ ...canonical, actorUserId }),
  });
  return (endpoint === 'quote' ? quote : create)(request, {});
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.userId = userA;
  mock.allowed = true;
  mock.create.mockResolvedValue({ orderId, orderNumber: 'A100', trackingToken: 'tracking', replayed: false, total: 10000 });
  mock.quote.mockResolvedValue({ total: 10000, platformFeeAmount: 0 });
  mock.snapshots.mockResolvedValue([{ id: orderId, restaurantId, orderNumber: 'A100' }]);
});

describe('counter requests stay bound to the cashier screen', () => {
  it.each<Endpoint>(['create', 'quote'])('rejects an old %s screen after another cashier signs in, before effects', async (endpoint) => {
    mock.userId = userB;
    const response = await call(endpoint, userA);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.quote).not.toHaveBeenCalled();
    expect(mock.rate).not.toHaveBeenCalled();
    expect(mock.db).not.toHaveBeenCalled();
    expect(mock.snapshots).not.toHaveBeenCalled();
  });

  it.each<Endpoint>(['create', 'quote'])('requires an explicit actor binding on %s', async (endpoint) => {
    const response = await call(endpoint, undefined);
    expect(response.status).toBe(401);
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.quote).not.toHaveBeenCalled();
    expect(mock.rate).not.toHaveBeenCalled();
  });

  it.each<Endpoint>(['create', 'quote'])('rejects a correctly bound actor without restaurant permission before %s effects', async (endpoint) => {
    mock.allowed = false;
    const response = await call(endpoint, userA);
    expect(response.status).toBe(403);
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.quote).not.toHaveBeenCalled();
    expect(mock.rate).not.toHaveBeenCalled();
  });

  it.each<Endpoint>(['create', 'quote'])('returns the verified viewer with an authorized %s, excluding actor metadata from canonical data', async (endpoint) => {
    const response = await call(endpoint, userA);
    expect(response.status).toBe(endpoint === 'create' ? 201 : 200);
    expect((await response.json()).viewerUserId).toBe(userA);
    if (endpoint === 'create') {
      const args = mock.create.mock.calls[0];
      expect(args[1]).not.toHaveProperty('actorUserId');
      expect(args[2]).toBe('old-persisted-counter-key');
      expect(args[3].userId).toBe(userA);
    } else {
      const args = mock.quote.mock.calls[0];
      expect(args[1]).not.toHaveProperty('actorUserId');
      expect(args[2].user.id).toBe(userA);
    }
  });
});
