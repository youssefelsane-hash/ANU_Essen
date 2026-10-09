import { z } from 'zod';

const note = z.string().max(300);
const payloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('HAND_IN'), restaurantId: z.uuid(), courierUserId: z.uuid(), amount: z.string().max(40), note }),
  z.object({ kind: z.literal('REVERSAL'), handInId: z.uuid(), note }),
]);
const attemptSchema = z.object({ actorUserId: z.uuid(), key: z.uuid(), payload: payloadSchema, pending: z.boolean() });

export type CourierCashPayload = z.infer<typeof payloadSchema>;
export type CourierCashAttempt = z.infer<typeof attemptSchema>;
export function courierCashScope(payload: CourierCashPayload): string {
  return payload.kind === 'HAND_IN' ? `hand-in:${payload.restaurantId}:${payload.courierUserId}` : `reverse:${payload.handInId}`;
}
export const courierCashAttemptKey = (actorUserId: string, scope: string) => `courier-cash:v1:${actorUserId}:${scope}`;

export function parseCourierCashAttempt(value: unknown, actorUserId: string, scope: string): CourierCashAttempt | null {
  const parsed = attemptSchema.safeParse(value);
  return parsed.success && parsed.data.actorUserId === actorUserId && courierCashScope(parsed.data.payload) === scope ? parsed.data : null;
}

export function prepareCourierCashAttempt(current: CourierCashAttempt | null, actorUserId: string, payload: CourierCashPayload, newKey: () => string): CourierCashAttempt {
  if (current && (current.actorUserId !== actorUserId || courierCashScope(current.payload) !== courierCashScope(payload))) current = null;
  if (current?.pending) return current;
  if (current && JSON.stringify(current.payload) === JSON.stringify(payload)) return { ...current, pending: true };
  return attemptSchema.parse({ actorUserId, key: newKey(), payload, pending: true });
}

export function cashAttemptFormData(attempt: CourierCashAttempt): FormData {
  const data = new FormData();
  data.set('actorUserId', attempt.actorUserId);
  data.set('idempotencyKey', attempt.key);
  for (const [key, value] of Object.entries(attempt.payload)) if (key !== 'kind') data.set(key, value);
  return data;
}

export function saveCourierCashAttempt(attempt: CourierCashAttempt, storage: Pick<Storage, 'setItem' | 'getItem'>): boolean {
  try {
    const key = courierCashAttemptKey(attempt.actorUserId, courierCashScope(attempt.payload));
    const value = JSON.stringify(attempt);
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch { return false; }
}

export function isDefiniteCashRejection(code?: string): boolean {
  return !!code && ['VALIDATION', 'FORBIDDEN', 'UNAUTHENTICATED', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_MISMATCH', 'PAYLOAD_TOO_LARGE'].includes(code);
}
