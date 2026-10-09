import { randomBytes, randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { loyaltyAwards, loyaltyCards, orders, promotions, restaurants } from '../db/schema';
import { ELSANE_LETTERS, ELSANE_WORD } from '../../lib/domain/loyalty';
import { audit } from './audit';

type OrderRow = typeof orders.$inferSelect;
type RestaurantRow = typeof restaurants.$inferSelect;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const voucherCode = () => `ELSANE-${[...randomBytes(5)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`;

/** The order counts for the game: an online order with a phone, big enough, at a restaurant that plays. */
export function earnsLetter(order: Pick<OrderRow, 'channel' | 'customerId' | 'subtotal' | 'discountTotal'>, r: Pick<RestaurantRow, 'loyaltyEnabled' | 'loyaltyMinOrder'>): boolean {
  return r.loyaltyEnabled && order.channel === 'ONLINE' && !!order.customerId && order.subtotal - order.discountTotal >= r.loyaltyMinOrder;
}

/**
 * Called inside the transaction that completes an order. Gives one random missing letter (so the word
 * always completes in exactly five orders); the fifth letter creates a single-use personal voucher and
 * starts a new card. Idempotent per order.
 */
export async function awardLetter(tx: Db, order: OrderRow, now: Date) {
  const [r] = await tx.select().from(restaurants).where(eq(restaurants.id, order.restaurantId));
  if (!r || !earnsLetter(order, r) || !order.customerId) return null;
  const [already] = await tx.select({ id: loyaltyAwards.id }).from(loyaltyAwards).where(eq(loyaltyAwards.orderId, order.id));
  if (already) return null;

  await tx.insert(loyaltyCards).values({ restaurantId: r.id, customerId: order.customerId }).onConflictDoNothing();
  const [card] = await tx.select().from(loyaltyCards)
    .where(and(eq(loyaltyCards.restaurantId, r.id), eq(loyaltyCards.customerId, order.customerId))).for('update');
  const missing = ELSANE_LETTERS.filter((l) => !card.letters.includes(l));
  const letter = missing[randomInt(missing.length)];
  const letters = [...card.letters, letter];
  let voucherPromotionId: string | null = null;

  if (letters.length >= ELSANE_LETTERS.length) {
    for (let attempt = 0; attempt < 3 && !voucherPromotionId; attempt++) {
      const [promo] = await tx.insert(promotions).values({
        restaurantId: r.id,
        name: `${ELSANE_WORD} — ${order.customerName}`,
        type: 'FIXED',
        value: r.loyaltyReward,
        code: voucherCode(),
        autoApply: false,
        startsAt: now,
        endsAt: new Date(now.getTime() + r.loyaltyVoucherDays * 86_400_000),
        usageLimit: 1,
        customerPhone: order.customerPhone,
      }).onConflictDoNothing().returning({ id: promotions.id });
      voucherPromotionId = promo?.id ?? null;
    }
    await tx.update(loyaltyCards).set({ letters: [], wordsCompleted: sql`${loyaltyCards.wordsCompleted} + 1`, updatedAt: now }).where(eq(loyaltyCards.id, card.id));
  } else {
    await tx.update(loyaltyCards).set({ letters, updatedAt: now }).where(eq(loyaltyCards.id, card.id));
  }
  await tx.insert(loyaltyAwards).values({ cardId: card.id, orderId: order.id, letter, voucherPromotionId, createdAt: now });
  if (voucherPromotionId) {
    await audit({ actor: { type: 'SYSTEM', label: 'elsane' }, action: 'loyalty.voucher_issued', entity: 'promotion', entityId: voucherPromotionId, restaurantId: r.id, after: { orderNumber: order.orderNumber, amount: r.loyaltyReward } }, tx);
  }
  return { letter, completed: !!voucherPromotionId };
}

export interface LoyaltyVoucher { code: string; amount: number; expiresAt: number }

/** Unused, unexpired prize codes of one phone at one restaurant. */
export async function activeVouchers(d: Db, restaurantId: string, phone: string, now = new Date()): Promise<LoyaltyVoucher[]> {
  const rows = await d.select({ code: promotions.code, value: promotions.value, endsAt: promotions.endsAt }).from(promotions)
    .where(and(
      eq(promotions.restaurantId, restaurantId), eq(promotions.customerPhone, phone), eq(promotions.isActive, true),
      or(isNull(promotions.usageLimit), lt(promotions.usedCount, promotions.usageLimit)),
      or(isNull(promotions.endsAt), gt(promotions.endsAt, now)),
    ))
    .orderBy(desc(promotions.createdAt));
  return rows.filter((v) => v.code).map((v) => ({ code: v.code!, amount: v.value, expiresAt: v.endsAt?.getTime() ?? 0 }));
}

export interface LoyaltyView {
  enabled: boolean;
  reward: number;
  minOrder: number;
  /** Letters on the current card. */
  letters: string[];
  /** Letter this order earned (once delivered). */
  earned: string | null;
  /** This order completed the word. */
  completedWord: boolean;
  /** Not delivered yet but will earn a letter. */
  pending: boolean;
  vouchers: LoyaltyVoucher[];
}

/** Game state as seen from one order (bearer: its tracking token). */
export async function loyaltyForOrder(d: Db, order: OrderRow, r: RestaurantRow): Promise<LoyaltyView | null> {
  const [award] = await d.select().from(loyaltyAwards).where(eq(loyaltyAwards.orderId, order.id));
  if (!r.loyaltyEnabled && !award) return null;
  const [card] = order.customerId
    ? await d.select().from(loyaltyCards).where(and(eq(loyaltyCards.restaurantId, r.id), eq(loyaltyCards.customerId, order.customerId)))
    : [];
  return {
    enabled: r.loyaltyEnabled,
    reward: r.loyaltyReward,
    minOrder: r.loyaltyMinOrder,
    letters: card?.letters ?? [],
    earned: award?.letter ?? null,
    completedWord: !!award?.voucherPromotionId,
    pending: !award && !['COMPLETED', 'CANCELLED'].includes(order.status) && earnsLetter(order, r),
    vouchers: order.customerPhone ? await activeVouchers(d, r.id, order.customerPhone) : [],
  };
}

/** Admin numbers for one restaurant. */
export async function loyaltyStats(d: Db, restaurantId: string) {
  const [letters] = await d.select({ n: sql<number>`count(*)::int` }).from(loyaltyAwards)
    .innerJoin(loyaltyCards, eq(loyaltyCards.id, loyaltyAwards.cardId)).where(eq(loyaltyCards.restaurantId, restaurantId));
  const [vouchers] = await d.select({ issued: sql<number>`count(*)::int`, used: sql<number>`count(*) filter (where ${promotions.usedCount} > 0)::int` })
    .from(promotions).where(and(eq(promotions.restaurantId, restaurantId), sql`${promotions.customerPhone} is not null`, sql`${promotions.code} like 'ELSANE-%'`));
  const [players] = await d.select({ n: sql<number>`count(*)::int` }).from(loyaltyCards).where(eq(loyaltyCards.restaurantId, restaurantId));
  return { letters: Number(letters?.n ?? 0), vouchersIssued: Number(vouchers?.issued ?? 0), vouchersUsed: Number(vouchers?.used ?? 0), players: Number(players?.n ?? 0) };
}
