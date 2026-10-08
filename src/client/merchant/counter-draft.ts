import { z } from 'zod';
import { counterOrderSchema, cartLineSchema, idempotencyKeySchema } from '@/lib/validation';

export type CounterPayload = z.infer<typeof counterOrderSchema>;

const totalsSchema = z.object({
  total: z.number().int().nonnegative().safe(),
  discount: z.number().int().nonnegative().safe(),
  deliveryFee: z.number().int().nonnegative().safe(),
});

const draftSchema = z.object({
  restaurantId: z.uuid(),
  userId: z.uuid(),
  items: z.array(cartLineSchema).max(30),
  name: z.string().max(60),
  phone: z.string().max(20),
  note: z.string().max(300),
  pointId: z.uuid().nullable(),
  payment: counterOrderSchema.shape.paymentMethod,
});

const attemptSchema = z.object({
  restaurantId: z.uuid(),
  userId: z.uuid(),
  key: idempotencyKeySchema,
  body: z.string().max(50_000),
  pending: z.boolean(),
  totals: totalsSchema,
});

export type CounterDraft = z.infer<typeof draftSchema>;
export type CounterAttempt = z.infer<typeof attemptSchema>;
export const counterDraftKey = (restaurantId: string, userId: string) => `counter-draft:v1:${restaurantId}:${userId}`;
export const counterAttemptKey = (restaurantId: string, userId: string) => `counter-attempt:v1:${restaurantId}:${userId}`;

/** Browser data can be stale, damaged, or left by another staff account. */
export function parseCounterDraft(value: unknown, restaurantId: string, userId: string): CounterDraft | null {
  const parsed = draftSchema.safeParse(value);
  return parsed.success && parsed.data.restaurantId === restaurantId && parsed.data.userId === userId ? parsed.data : null;
}

export function parseCounterAttempt(value: unknown, restaurantId: string, userId: string): CounterAttempt | null {
  const parsed = attemptSchema.safeParse(value);
  if (!parsed.success || parsed.data.restaurantId !== restaurantId || parsed.data.userId !== userId) return null;
  try {
    const payload = counterOrderSchema.safeParse(JSON.parse(parsed.data.body));
    return payload.success && payload.data.restaurantId === restaurantId ? parsed.data : null;
  } catch { return null; }
}

export function counterAttemptPayload(attempt: CounterAttempt): CounterPayload {
  return counterOrderSchema.parse(JSON.parse(attempt.body));
}

/** Add the screen identity only for transport. Old unresolved body/key snapshots remain unchanged. */
export function counterRequestBody(attempt: CounterAttempt, currentUserId: string): string {
  if (attempt.userId !== currentUserId) throw new Error('Counter attempt belongs to another account');
  return JSON.stringify({ ...counterAttemptPayload(attempt), actorUserId: currentUserId });
}

function sameOrder(left: CounterPayload, right: CounterPayload): boolean {
  // A browser-generated device ID is transport metadata, not a different customer order.
  return JSON.stringify({ ...left, deviceId: undefined }) === JSON.stringify({ ...right, deviceId: undefined });
}

/** An unknown outcome must replay its exact body/key, including after refresh or a menu change. */
export function prepareCounterAttempt(
  current: CounterAttempt | null,
  payload: CounterPayload,
  userId: string,
  newKey: () => string,
  totals: CounterAttempt['totals'],
): CounterAttempt {
  if (current?.restaurantId !== payload.restaurantId || current?.userId !== userId) current = null;
  if (current?.pending) return current;
  const cleanPayload = counterOrderSchema.parse(payload);
  const cleanTotals = totalsSchema.parse(totals);
  if (current && sameOrder(counterAttemptPayload(current), cleanPayload)) return { ...current, pending: true, totals: cleanTotals };
  return { restaurantId: cleanPayload.restaurantId, userId, key: newKey(), body: JSON.stringify(cleanPayload), pending: true, totals: cleanTotals };
}

export function counterAttemptAfterRejection(attempt: CounterAttempt, status: number, replaying: boolean): CounterAttempt {
  // Rejection of a replay (e.g. an expired session) does not resolve the earlier unknown send.
  return status >= 400 && status < 500 && !replaying ? { ...attempt, pending: false } : attempt;
}

/** Save before sending: losing a newly generated key after a refresh could create another order. */
export function persistCounterAttempt(attempt: CounterAttempt, storage: Pick<Storage, 'setItem' | 'getItem'>): boolean {
  try {
    const key = counterAttemptKey(attempt.restaurantId, attempt.userId);
    const value = JSON.stringify(attempt);
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch { return false; }
}
