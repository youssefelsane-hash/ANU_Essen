import { describe, expect, it } from 'vitest';
import { estimateLine, lineKey, normalizeCart, type CartLine } from '@/client/cart';
import { applyPending } from '@/client/merchant/engine';
import { merchantCacheKey } from '@/client/merchant/local-db';
import type { OutboxEntry } from '@/client/merchant/local-db';
import type { OrderSnapshot, PublicMenu } from '@/lib/types';

const menu = {
  products: [{ id: 'p1', nameAr: 'شاورما', basePrice: 6000, isAvailable: true, variants: [], addonGroupIds: ['g1'] }],
  addonGroups: [
    { id: 'g1', minSelect: 1, maxSelect: 1, addons: [{ id: 'a1', nameAr: 'ثومية', price: 500, isAvailable: true }] },
    { id: 'g2', minSelect: 0, maxSelect: 2, addons: [{ id: 'other', nameAr: 'إضافة منتج آخر', price: 1000, isAvailable: true }] },
  ],
} as unknown as PublicMenu;
const line = (over: Partial<CartLine> = {}): CartLine => ({ key: 'old-key', productId: 'p1', variantId: null, addonIds: ['a1'], quantity: 1, ...over });

describe('saved carts and shared terminals', () => {
  it('recovers a damaged saved cart without crashing checkout or trusting obsolete keys', () => {
    expect(normalizeCart({ broken: true })).toEqual([]);
    const recovered = normalizeCart([null, 12, { broken: true }, line({ quantity: 2, addonIds: ['a1', 'a1'] }), line({ quantity: 3 }), line({ quantity: -1 }), line({ addonIds: null } as unknown as Partial<CartLine>)]);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toEqual(line({ key: lineKey('p1', null, ['a1']), addonIds: ['a1'], quantity: 5 }));
  });

  it('marks obsolete, foreign and missing required selections as unavailable before checkout', () => {
    expect(estimateLine(menu, line()).available).toBe(true);
    expect(estimateLine(menu, line({ addonIds: ['missing'] })).available).toBe(false);
    expect(estimateLine(menu, line({ addonIds: ['other'] })).available).toBe(false);
    expect(estimateLine(menu, line({ addonIds: [] })).available).toBe(false);
    expect(estimateLine(menu, line({ variantId: 'removed-variant' })).available).toBe(false);
    expect(estimateLine(menu, line({ quantity: 51 })).available).toBe(false);
  });

  it('isolates an owner cache and pending outbox from another user, restaurant or permission set', () => {
    const owner = merchantCacheKey('store-a', 'owner', ['orders.view', 'payments.verify']);
    expect(owner).toBe('merchant:v2:store-a:owner:orders.view,payments.verify');
    expect(owner).toBe(merchantCacheKey('store-a', 'owner', ['payments.verify', 'orders.view']));
    expect(owner).not.toBe(merchantCacheKey('store-a', 'delivery', ['orders.delivery']));
    expect(owner).not.toBe(merchantCacheKey('store-b', 'owner', ['orders.view', 'payments.verify']));
    expect(owner).not.toBe(merchantCacheKey('store-a', 'owner', ['orders.view']));
  });

  it('shows cash collected and rejected transfers consistently while offline', () => {
    const pending = (action: OutboxEntry['action']): OutboxEntry[] => [{ eventId: 'event', orderId: 'order', action, occurredAt: 123, createdAt: 123, attempts: 0 }];
    const cash = { id: 'order', status: 'ARRIVED_AT_GATE', paymentMethod: 'CASH', paymentStatus: 'CASH' } as OrderSnapshot;
    expect(applyPending(cash, pending('COMPLETE')).paymentStatus).toBe('PAYMENT_VERIFIED');
    const submitted = { id: 'order', status: 'PAYMENT_REVIEW', paymentMethod: 'INSTAPAY', paymentStatus: 'PAYMENT_SUBMITTED' } as OrderSnapshot;
    expect(applyPending(submitted, pending('REJECT_PAYMENT')).paymentStatus).toBe('PAYMENT_REJECTED');
  });
});
