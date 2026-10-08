import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/errors';

const mock = vi.hoisted(() => ({ userId: '', sync: vi.fn(), action: vi.fn(), cash: vi.fn(), rate: vi.fn(), db: vi.fn() }));
vi.mock('@/server/auth/session', () => ({ requireAuth: async () => {
  if (!mock.userId) throw new AppError('UNAUTHENTICATED');
  return { user: { id: mock.userId, name: 'Current account', email: 'test@example.test' } };
} }));
vi.mock('@/server/services/sync', () => ({ merchantSync: mock.sync }));
vi.mock('@/server/services/order-actions', () => ({ applyOrderAction: mock.action }));
vi.mock('@/server/services/couriers', () => ({ courierCashReport: mock.cash }));
vi.mock('@/server/rate-limit', () => ({ enforceRateLimit: mock.rate }));
vi.mock('@/server/db', () => ({ db: mock.db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }, reportError: vi.fn() }));

import { GET as sync } from '@/app/api/merchant/sync/route';
import { POST as action } from '@/app/api/merchant/actions/route';
import { GET as cash } from '@/app/api/merchant/delivery-summary/route';

const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
const restaurantId = '20000000-0000-4000-8000-000000000001';
const deviceId = '30000000-0000-4000-8000-000000000001';
const eventId = '40000000-0000-4000-8000-000000000001';
const orderId = '50000000-0000-4000-8000-000000000001';
type Endpoint = 'sync' | 'actions' | 'cash';
function call(endpoint: Endpoint, actorUserId: unknown) {
  const actor = actorUserId === undefined ? '' : `&actorUserId=${encodeURIComponent(String(actorUserId))}`;
  if (endpoint === 'sync') return sync(new Request(`http://localhost/api/merchant/sync?restaurantId=${restaurantId}&deviceId=${deviceId}&cursor=0${actor}`), {});
  if (endpoint === 'cash') return cash(new Request(`http://localhost/api/merchant/delivery-summary?restaurantId=${restaurantId}${actor}`), {});
  return action(new Request('http://localhost/api/merchant/actions', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ restaurantId, deviceId, actorUserId, actions: [{ eventId, orderId, action: 'OUT_FOR_DELIVERY', occurredAt: Date.now() }] }) }), {});
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.userId = userA;
  mock.sync.mockResolvedValue({ orders: [], cursor: 1 });
  mock.action.mockResolvedValue({ result: 'applied' });
  mock.cash.mockResolvedValue({ restaurantId, cashOutstanding: 1000 });
});

describe('authenticated merchant request account binding', () => {
  it.each<Endpoint>(['sync', 'actions', 'cash'])('rejects an old %s tab after another account signs in, before any reads or effects', async (endpoint) => {
    mock.userId = userB;
    const response = await call(endpoint, userA);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(mock.sync).not.toHaveBeenCalled();
    expect(mock.action).not.toHaveBeenCalled();
    expect(mock.cash).not.toHaveBeenCalled();
    expect(mock.rate).not.toHaveBeenCalled();
    expect(mock.db).not.toHaveBeenCalled();
  });

  it.each<Endpoint>(['sync', 'actions', 'cash'])('requires an explicit actor binding for %s', async (endpoint) => {
    const response = await call(endpoint, undefined);
    expect(response.status).toBe(401);
    expect(mock.sync).not.toHaveBeenCalled();
    expect(mock.action).not.toHaveBeenCalled();
    expect(mock.cash).not.toHaveBeenCalled();
  });

  it.each<Endpoint>(['sync', 'actions', 'cash'])('returns the verified account identity with an authorized %s response', async (endpoint) => {
    const response = await call(endpoint, userA);
    expect(response.status).toBe(200);
    expect((await response.json()).viewerUserId).toBe(userA);
    if (endpoint === 'actions') expect(mock.action.mock.calls[0][0].actor.userId).toBe(userA);
    if (endpoint === 'sync') expect(mock.sync.mock.calls[0][0].auth.user.id).toBe(userA);
    if (endpoint === 'cash') expect(mock.cash.mock.calls[0][1].user.id).toBe(userA);
  });
});
