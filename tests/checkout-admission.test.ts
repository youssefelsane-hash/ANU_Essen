import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { POST } from '@/app/api/public/stores/[slug]/orders/route';
import type { Db } from '@/server/db';
import * as s from '@/server/db/schema';
import { createOrder } from '@/server/services/checkout';
import { enforceRateLimit } from '@/server/rate-limit';
import { AppError } from '@/server/errors';
import type { CreateOrderInput } from '@/lib/validation';
import type { DemoSeedResult } from '@/server/seed';
import { setupTestDb } from './helpers/db';

let d: Db, client: PGlite, demo: DemoSeedResult;
const key = () => `admission-${crypto.randomUUID()}`;
const input = (phone: string): CreateOrderInput => ({
  customerName: 'Ahmed', customerPhone: phone, paymentMethod: 'CASH',
  items: [{ productId: demo.productIds['Chicken Shawarma Sandwich'], variantId: demo.variantIds['Chicken Shawarma Sandwich:Regular'], addonIds: [], quantity: 1 }],
});
async function checkout(body: CreateOrderInput, requestKey: string, ip: string) {
  const response = await POST(new Request('http://localhost/api/public/stores/alrayez/orders', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': requestKey, 'x-forwarded-for': ip, 'accept-language': 'en' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ slug: 'alrayez' }) });
  return { status: response.status, data: await response.json() };
}
async function phoneCount(phone: string) {
  const [row] = await d.select().from(s.rateLimits).where(eq(s.rateLimits.key, `order:phone:${phone}`));
  return row?.count ?? 0;
}

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost/test');
  vi.stubEnv('ORDER_IP_RATE_LIMIT', '600');
  vi.stubEnv('ORDER_PHONE_RATE_LIMIT', '8');
  vi.stubEnv('LOG_LEVEL', 'error');
  ({ d, client, demo } = await setupTestDb());
});
afterAll(async () => { await client.close(); vi.unstubAllEnvs(); });

describe('phone admission and retry safety through guest checkout', () => {
  it('admits 100 simultaneous copies of one checkout once and charges one phone allowance', async () => {
    const phone = '01010000001', requestKey = key(), body = input(phone);
    const responses = await Promise.all(Array.from({ length: 100 }, () => checkout(body, requestKey, '198.51.100.1')));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200 && r.data.replayed)).toHaveLength(99);
    expect(new Set(responses.map((r) => r.data.orderId)).size).toBe(1);
    expect(await phoneCount(phone)).toBe(1);
    const rows = await d.select().from(s.orders).where(eq(s.orders.idempotencyKey, requestKey));
    expect(rows).toHaveLength(1);
    const [ipProtection] = await d.select().from(s.rateLimits).where(eq(s.rateLimits.key, 'order:ip:198.51.100.1'));
    expect(ipProtection.count).toBe(100); // request-level protection still applies to retries
  });

  it('replays a committed order after the phone allowance is exhausted while rejecting a different payload', async () => {
    const phone = '01010000002', body = input(phone), firstKey = key();
    const original = await checkout(body, firstKey, '198.51.100.2');
    expect(original.status).toBe(201);
    for (let i = 1; i < 8; i++) expect((await checkout(body, key(), '198.51.100.2')).status).toBe(201);
    expect((await checkout(body, key(), '198.51.100.2')).status).toBe(429);
    const retry = await checkout(body, firstKey, '198.51.100.2');
    expect(retry.status).toBe(200);
    expect(retry.data.orderId).toBe(original.data.orderId);
    expect(retry.data.trackingToken).toBe(original.data.trackingToken);
    expect(retry.data.replayed).toBe(true);
    const mismatch = await checkout({ ...body, customerName: 'Different customer' }, firstKey, '198.51.100.2');
    expect(mismatch.status).toBe(422);
    expect(mismatch.data.error.code).toBe('IDEMPOTENCY_MISMATCH');
    expect(await phoneCount(phone)).toBe(8);
  });

  it('admits exactly eight simultaneous distinct orders and leaves no partial ninth order or number', async () => {
    const phone = '01010000003', body = input(phone);
    const [before] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
    const responses = await Promise.all(Array.from({ length: 9 }, () => checkout(body, key(), '198.51.100.3')));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(8);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(1);
    expect(await phoneCount(phone)).toBe(8);
    const rows = await d.select().from(s.orders).where(and(eq(s.orders.restaurantId, demo.restaurantId), eq(s.orders.customerPhone, phone)));
    expect(rows).toHaveLength(8);
    const [after] = await d.select().from(s.storeCounters).where(eq(s.storeCounters.restaurantId, demo.restaurantId));
    expect(after.orderSeq - before.orderSeq).toBe(8);
    expect(after.eventSeq - before.eventSeq).toBe(8);
  });

  it('rolls back phone admission when checkout fails before commit and allows the retry', async () => {
    const phone = '01010000004', requestKey = key(), body = input(phone);
    await expect(createOrder('alrayez', body, requestKey, new Date(), async (tx) => {
      await enforceRateLimit(`order:phone:${phone}`, 1, 600, tx);
      throw new AppError('CONFLICT', 'Checkout interrupted before commit');
    })).rejects.toSatisfy((error: unknown) => error instanceof AppError && error.code === 'CONFLICT');
    expect(await phoneCount(phone)).toBe(0);
    expect(await d.select().from(s.orders).where(eq(s.orders.idempotencyKey, requestKey))).toHaveLength(0);
    const retry = await createOrder('alrayez', body, requestKey, new Date(), (tx) => enforceRateLimit(`order:phone:${phone}`, 1, 600, tx));
    expect(retry.replayed).toBe(false);
    expect(await phoneCount(phone)).toBe(1);
  });
});
