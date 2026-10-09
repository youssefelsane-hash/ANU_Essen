/** "Collect ELSANE": one letter per delivered online order, a personal voucher for the full word. */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '@/server/db/schema';
import type { Db } from '@/server/db';
import type { AuthContext } from '@/server/auth/authz';
import { AppError } from '@/server/errors';
import { createCounterOrder, createOrder } from '@/server/services/checkout';
import { applyOrderAction } from '@/server/services/order-actions';
import { loadTrackingView } from '@/server/services/order-views';
import { loadPromotionRules } from '@/server/services/menu';
import { awardLetter, loyaltyStats } from '@/server/services/loyalty';
import { ELSANE_LETTERS } from '@/lib/domain/loyalty';
import { authFor, setupTestDb } from './helpers/db';

let d: Db;
let restaurantId: string;
let productId: string, variantId: string;
let owner: AuthContext;
let n = 0;
const key = () => `elsane-${++n}-${Math.random().toString(36).slice(2)}`;
const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
const items = (quantity = 1) => [{ productId, variantId, addonIds: [], quantity }];

async function deliveredOrder(phone: string, extra: { promoCode?: string } = {}) {
  const o = await createOrder('alrayez', { items: items(), customerName: 'Nour', customerPhone: phone, paymentMethod: 'CASH', ...extra }, key());
  for (const action of ['MARK_READY', 'OUT_FOR_DELIVERY', 'MARK_ARRIVED', 'COMPLETE'] as const) {
    await applyOrderAction({ orderId: o.orderId, action, actor: { type: 'USER', userId: owner.user.id, label: owner.user.name, auth: owner } });
  }
  return o;
}

beforeAll(async () => {
  let demo;
  ({ d, demo } = await setupTestDb());
  restaurantId = demo.restaurantId;
  productId = demo.productIds['Chicken Shawarma Sandwich'];
  variantId = demo.variantIds['Chicken Shawarma Sandwich:Regular'];
  owner = await authFor(d, 'owner@alrayez.test');
});

describe('collect ELSANE', () => {
  it('gives nothing while the restaurant has the game off', async () => {
    const o = await deliveredOrder('01090000001');
    expect((await loadTrackingView(d, o.trackingToken))!.order.loyalty).toBeNull();
  });

  it('awards five different letters, then a single-use voucher only the winner can use', async () => {
    await d.update(s.restaurants).set({ loyaltyEnabled: true, loyaltyReward: 2_000, loyaltyMinOrder: 0, loyaltyVoucherDays: 30 }).where(eq(s.restaurants.id, restaurantId));
    const phone = '01090000002';
    const won: string[] = [];
    let last;
    for (let i = 0; i < 5; i++) {
      const pending = await createOrder('alrayez', { items: items(), customerName: 'Nour', customerPhone: phone, paymentMethod: 'CASH' }, key());
      expect((await loadTrackingView(d, pending.trackingToken))!.order.loyalty?.pending).toBe(true);
      await applyOrderAction({ orderId: pending.orderId, action: 'CANCEL', actor: { type: 'USER', userId: owner.user.id, label: owner.user.name, auth: owner }, payload: { reason: 'test' } });
      last = await deliveredOrder(phone);
      const game = (await loadTrackingView(d, last.trackingToken))!.order.loyalty!;
      expect(game.earned).toBeTruthy();
      won.push(game.earned!);
    }
    expect(new Set(won)).toEqual(new Set(ELSANE_LETTERS));
    const finale = (await loadTrackingView(d, last!.trackingToken))!.order.loyalty!;
    expect(finale.completedWord).toBe(true);
    expect(finale.letters).toEqual([]);
    expect(finale.vouchers).toHaveLength(1);
    const { code, amount } = finale.vouchers[0];
    expect(amount).toBe(2_000);
    expect(code).toMatch(/^ELSANE-[A-Z0-9]{5}$/);

    // Private: not loaded for everyone, refused for another phone, works once for the winner.
    expect((await loadPromotionRules(d, restaurantId)).some((p) => p.code === code)).toBe(false);
    await expectCode(createOrder('alrayez', { items: items(), customerName: 'X', customerPhone: '01090000099', paymentMethod: 'CASH', promoCode: code }, key()), 'PROMO_INVALID');
    const used = await createOrder('alrayez', { items: items(), customerName: 'Nour', customerPhone: phone, paymentMethod: 'CASH', promoCode: code }, key());
    expect((await d.select().from(s.orders).where(eq(s.orders.id, used.orderId)))[0].discountTotal).toBe(2_000);
    await expectCode(createOrder('alrayez', { items: items(), customerName: 'Nour', customerPhone: phone, paymentMethod: 'CASH', promoCode: code }, key()), 'PROMO_INVALID');

    const stats = await loyaltyStats(d, restaurantId);
    expect(stats.vouchersIssued).toBe(1);
    expect(stats.vouchersUsed).toBe(1);
  });

  it('skips counter orders and orders below the minimum, and never awards an order twice', async () => {
    await d.update(s.restaurants).set({ loyaltyEnabled: true, loyaltyMinOrder: 1_000_000 }).where(eq(s.restaurants.id, restaurantId));
    const small = await deliveredOrder('01090000003');
    expect((await loadTrackingView(d, small.trackingToken))!.order.loyalty?.earned).toBeNull();

    await d.update(s.restaurants).set({ loyaltyMinOrder: 0 }).where(eq(s.restaurants.id, restaurantId));
    const counter = await createCounterOrder(restaurantId, { items: items(), customerPhone: '01090000003', paymentMethod: 'CASH', deliveryPointId: null }, key(), { userId: owner.user.id, name: owner.user.name, auth: owner });
    const [row] = await d.select().from(s.orders).where(eq(s.orders.id, counter.orderId));
    expect(await awardLetter(d, row, new Date())).toBeNull();

    const online = await deliveredOrder('01090000003');
    const [done] = await d.select().from(s.orders).where(eq(s.orders.id, online.orderId));
    expect(await awardLetter(d, done, new Date())).toBeNull();
    expect((await d.select().from(s.loyaltyAwards).where(eq(s.loyaltyAwards.orderId, online.orderId)))).toHaveLength(1);
  });
});
