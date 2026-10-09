import { describe, expect, it, vi } from 'vitest';
import { cashAttemptFormData, courierCashAttemptKey, courierCashScope, isDefiniteCashRejection, parseCourierCashAttempt, prepareCourierCashAttempt, saveCourierCashAttempt, type CourierCashPayload } from '@/client/merchant/courier-cash-attempt';

const actor = '00000000-0000-4000-8000-000000000001';
const restaurant = '00000000-0000-4000-8000-000000000002';
const courier = '00000000-0000-4000-8000-000000000003';
const other = '00000000-0000-4000-8000-000000000004';
const key = '00000000-0000-4000-8000-000000000005';
const nextKey = '00000000-0000-4000-8000-000000000006';
const payload: CourierCashPayload = { kind: 'HAND_IN', restaurantId: restaurant, courierUserId: courier, amount: '100.50', note: 'receipt-18' };

describe('courier cash entry recovery', () => {
  it('saves and restores the exact amount/reference/key instead of accepting edits after an unknown result', () => {
    const attempt = prepareCourierCashAttempt(null, actor, payload, () => key);
    const data = new Map<string, string>();
    expect(saveCourierCashAttempt(attempt, { setItem: (key, value) => { data.set(key, value); }, getItem: (key) => data.get(key) ?? null })).toBe(true);
    const restored = parseCourierCashAttempt(JSON.parse(data.get(courierCashAttemptKey(actor, courierCashScope(payload)))!), actor, courierCashScope(payload))!;
    const newKey = vi.fn(() => nextKey);
    const retry = prepareCourierCashAttempt(restored, actor, { ...payload, amount: '999', note: 'Changed' }, newKey);
    expect(newKey).not.toHaveBeenCalled();
    expect(Object.fromEntries(cashAttemptFormData(retry))).toEqual({ actorUserId: actor, restaurantId: restaurant, courierUserId: courier, amount: '100.50', note: 'receipt-18', idempotencyKey: key });
  });

  it('uses a new key for corrected data after a definite rejection, keeping unchanged retry keys', () => {
    const attempt = { ...prepareCourierCashAttempt(null, actor, payload, () => key), pending: false };
    expect(prepareCourierCashAttempt(attempt, actor, payload, () => nextKey).key).toBe(key);
    expect(prepareCourierCashAttempt(attempt, actor, { ...payload, amount: '80' }, () => nextKey).key).toBe(nextKey);
    expect(isDefiniteCashRejection('VALIDATION')).toBe(true);
    expect(isDefiniteCashRejection('INTERNAL')).toBe(false);
    expect(isDefiniteCashRejection()).toBe(false);
  });

  it('isolates another actor, courier, restaurant and reversal target', () => {
    const attempt = prepareCourierCashAttempt(null, actor, payload, () => key);
    expect(parseCourierCashAttempt(attempt, other, courierCashScope(payload))).toBeNull();
    expect(parseCourierCashAttempt(attempt, actor, courierCashScope({ ...payload, restaurantId: other }))).toBeNull();
    expect(parseCourierCashAttempt(attempt, actor, courierCashScope({ ...payload, courierUserId: other }))).toBeNull();
    expect(parseCourierCashAttempt(attempt, actor, courierCashScope({ kind: 'REVERSAL', handInId: other, note: 'Wrong entry' }))).toBeNull();
    const separate = prepareCourierCashAttempt(attempt, actor, { ...payload, restaurantId: other }, () => nextKey);
    expect(separate.key).toBe(nextKey);
  });

  it('keeps an exact reversal target and required correction reason across retries', () => {
    const reversal = prepareCourierCashAttempt(null, actor, { kind: 'REVERSAL', handInId: restaurant, note: 'Duplicate receipt' }, () => key);
    const retry = prepareCourierCashAttempt(reversal, actor, { kind: 'REVERSAL', handInId: restaurant, note: 'Changed' }, () => nextKey);
    expect(Object.fromEntries(cashAttemptFormData(retry))).toEqual({ actorUserId: actor, handInId: restaurant, note: 'Duplicate receipt', idempotencyKey: key });
  });

  it('rejects corrupted state and detects storage failure before a new financial action', () => {
    const attempt = prepareCourierCashAttempt(null, actor, payload, () => key);
    for (const raw of [null, [], { ...attempt, key: 'bad' }, { ...attempt, pending: 'yes' }, { ...attempt, payload: { ...payload, courierUserId: 'invalid' } }]) {
      expect(parseCourierCashAttempt(raw, actor, courierCashScope(payload))).toBeNull();
    }
    expect(saveCourierCashAttempt(attempt, { setItem() { throw new Error('Quota exceeded'); }, getItem: () => null })).toBe(false);
    expect(saveCourierCashAttempt(attempt, { setItem() {}, getItem: () => null })).toBe(false);
  });
});
