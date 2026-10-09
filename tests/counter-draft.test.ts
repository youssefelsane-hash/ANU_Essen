import { describe, expect, it, vi } from 'vitest';
import {
  counterAttemptAfterRejection,
  counterAttemptKey,
  counterAttemptPayload,
  counterDraftKey,
  counterRequestBody,
  parseCounterAttempt,
  parseCounterDraft,
  persistCounterAttempt,
  prepareCounterAttempt,
  type CounterPayload,
} from '@/client/merchant/counter-draft';

const restaurantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const productId = '00000000-0000-4000-8000-000000000004';
const pointId = '00000000-0000-4000-8000-000000000005';
const payload: CounterPayload = {
  restaurantId,
  deviceId: '00000000-0000-4000-8000-000000000006',
  items: [{ productId, variantId: null, addonIds: [], quantity: 1 }],
  customerName: null,
  customerPhone: null,
  note: 'بدون بصل',
  paymentMethod: 'CASH',
  deliveryPointId: pointId,
};
const totals = { total: 10_000, discount: 0, deliveryFee: 0 };

describe('counter drafts and ambiguous network outcomes', () => {
  it('adds the verified screen actor for transport without changing an old pending body or key', () => {
    const first = prepareCounterAttempt(null, payload, userId, () => 'counter-key-original', totals);
    expect(JSON.parse(first.body)).not.toHaveProperty('actorUserId');
    const restored = parseCounterAttempt(JSON.parse(JSON.stringify(first)), restaurantId, userId)!;
    const before = JSON.stringify(restored);
    const transport = JSON.parse(counterRequestBody(restored, userId));
    expect(transport).toEqual({ ...counterAttemptPayload(first), actorUserId: userId });
    expect(JSON.stringify(restored)).toBe(before);
    expect(restored.key).toBe(first.key);
    expect(restored.body).toBe(first.body);
    expect(() => counterRequestBody(restored, otherId)).toThrow('another account');
    expect(counterAttemptAfterRejection(restored, 401, true)).toBe(restored);
    expect(restored.pending).toBe(true);
  });
  it('restores an unknown outcome with its exact key/body even after edits, a refresh or a removed pickup point', () => {
    const first = prepareCounterAttempt(null, payload, userId, () => 'counter-key-original', totals);
    const storage = new Map<string, string>();
    expect(persistCounterAttempt(first, {
      setItem: (key, value) => { storage.set(key, value); },
      getItem: (key) => storage.get(key) ?? null,
    })).toBe(true);
    const restored = parseCounterAttempt(JSON.parse(storage.get(counterAttemptKey(restaurantId, userId))!), restaurantId, userId)!;
    const newKey = vi.fn(() => 'counter-key-other');
    const retry = prepareCounterAttempt(restored, {
      ...payload, customerName: 'Changed', paymentMethod: 'INSTAPAY', deliveryPointId: otherId,
      items: [{ ...payload.items[0], quantity: 3 }],
    }, userId, newKey, { total: 40_000, discount: 0, deliveryFee: 500 });
    expect(newKey).not.toHaveBeenCalled();
    expect(retry.key).toBe(first.key);
    expect(retry.body).toBe(first.body);
    expect(retry.totals).toEqual(totals);
    expect(counterAttemptPayload(retry).deliveryPointId).toBe(pointId);
  });

  it('keeps 5xx and failed authenticated replays locked instead of discarding the original request', () => {
    const first = prepareCounterAttempt(null, payload, userId, () => 'counter-key-original', totals);
    for (const status of [500, 502, 503]) expect(counterAttemptAfterRejection(first, status, false)).toBe(first);
    for (const status of [400, 401, 403, 409, 422, 429, 500]) expect(counterAttemptAfterRejection(first, status, true)).toBe(first);
  });

  it('allows corrections after a definite first-send rejection while reusing the key for unchanged details', () => {
    const first = prepareCounterAttempt(null, payload, userId, () => 'counter-key-original', totals);
    const rejected = counterAttemptAfterRejection(first, 422, false);
    expect(rejected.pending).toBe(false);
    const newKey = vi.fn(() => 'counter-key-revised');
    const same = prepareCounterAttempt(rejected, { ...payload, deviceId: otherId }, userId, newKey, { ...totals, total: 11_000 });
    expect(newKey).not.toHaveBeenCalled();
    expect(same.key).toBe(first.key);
    expect(same.body).toBe(first.body);
    expect(same.totals.total).toBe(11_000);
    const edited = prepareCounterAttempt(rejected, { ...payload, paymentMethod: 'INSTAPAY' }, userId, newKey, totals);
    expect(edited.key).toBe('counter-key-revised');
    expect(counterAttemptPayload(edited).paymentMethod).toBe('INSTAPAY');
  });

  it('isolates drafts and attempt keys from customer carts, other staff and other restaurants', () => {
    const first = prepareCounterAttempt(null, payload, userId, () => 'counter-key-original', totals);
    expect(counterDraftKey(restaurantId, userId)).not.toBe(counterDraftKey(restaurantId, otherId));
    expect(counterAttemptKey(restaurantId, userId)).not.toBe(counterAttemptKey(otherId, userId));
    expect(counterDraftKey(restaurantId, userId)).not.toMatch(/^cart:/);
    expect(parseCounterAttempt(first, restaurantId, otherId)).toBeNull();
    expect(parseCounterAttempt(first, otherId, userId)).toBeNull();
    expect(parseCounterAttempt({ ...first, body: JSON.stringify({ ...payload, restaurantId: otherId }) }, restaurantId, userId)).toBeNull();
    const isolated = prepareCounterAttempt(first, payload, otherId, () => 'other-staff-key', totals);
    expect(isolated.key).toBe('other-staff-key');
  });

  it('rejects damaged browser data and never silently reports a failed durable write as saved', () => {
    const first = prepareCounterAttempt(null, payload, userId, () => 'counter-key-original', totals);
    for (const raw of [null, [], { ...first, body: '{broken' }, { ...first, key: 'bad key' }, { ...first, pending: 'yes' }, { ...first, totals: { ...totals, total: -1 } }, { ...first, body: JSON.stringify({ ...payload, items: [{ ...payload.items[0], quantity: 51 }] }) }]) {
      expect(parseCounterAttempt(raw, restaurantId, userId)).toBeNull();
    }
    expect(persistCounterAttempt(first, { setItem() { throw new Error('Storage blocked'); }, getItem: () => null })).toBe(false);
    expect(persistCounterAttempt(first, { setItem() {}, getItem: () => null })).toBe(false);
  });

  it('validates editable draft fields without requiring a product or pickup point to still be in the menu', () => {
    const draft = { restaurantId, userId, items: payload.items, name: 'عميل', phone: '', note: '', payment: 'CASH', pointId };
    expect(parseCounterDraft(draft, restaurantId, userId)).toEqual(draft);
    expect(parseCounterDraft({ ...draft, items: [] }, restaurantId, userId)?.items).toEqual([]);
    expect(parseCounterDraft(draft, restaurantId, otherId)).toBeNull();
    expect(parseCounterDraft({ ...draft, phone: 123 }, restaurantId, userId)).toBeNull();
    expect(parseCounterDraft({ ...draft, payment: 'PAID' }, restaurantId, userId)).toBeNull();
    expect(parseCounterDraft({ ...draft, items: [{ ...payload.items[0], addonIds: ['invalid'] }] }, restaurantId, userId)).toBeNull();
  });
});
