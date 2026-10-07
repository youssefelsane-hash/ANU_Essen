import { describe, expect, it } from 'vitest';
import { commissionFor, priceCart, PricingError, type MenuAddonGroup, type MenuProduct, type PricingContext, type PromotionRule } from '@/lib/domain/pricing';

const shawarma: MenuProduct = {
  id: 'p1', nameAr: 'شاورما', nameEn: 'Shawarma', basePrice: 6000, isAvailable: true, isActive: true, prepLoadUnits: 1,
  variants: [
    { id: 'v1', nameAr: 'عادي', nameEn: 'Regular', price: 6000, isAvailable: true, prepLoadUnits: null },
    { id: 'v2', nameAr: 'كبير', nameEn: 'Large', price: 8000, isAvailable: true, prepLoadUnits: 2 },
  ],
  addonGroupIds: ['g1'],
};
const meal: MenuProduct = { id: 'p2', nameAr: 'وجبة', nameEn: 'Meal', basePrice: 14000, isAvailable: true, isActive: true, prepLoadUnits: 2, variants: [], addonGroupIds: [] };
const fries: MenuProduct = { id: 'p3', nameAr: 'بطاطس', nameEn: 'Fries', basePrice: 3500, isAvailable: false, isActive: true, prepLoadUnits: 1, variants: [], addonGroupIds: [] };
const extras: MenuAddonGroup = {
  id: 'g1', nameAr: 'إضافات', nameEn: 'Extras', minSelect: 0, maxSelect: 2,
  addons: [
    { id: 'a1', nameAr: 'ثومية', nameEn: 'Garlic', price: 500, isAvailable: true },
    { id: 'a2', nameAr: 'جبنة', nameEn: 'Cheese', price: 1000, isAvailable: true },
    { id: 'a3', nameAr: 'مخلل', nameEn: 'Pickles', price: 0, isAvailable: true },
  ],
};

const promo = (over: Partial<PromotionRule>): PromotionRule => ({
  id: 'promo', name: 'Promo', type: 'PERCENT', value: 1000, productId: null, code: null, autoApply: false, minSubtotal: 0,
  maxDiscount: null, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, isActive: true, ...over,
});

const ctx = (over: Partial<PricingContext> = {}): PricingContext => ({
  products: new Map([[shawarma.id, shawarma], [meal.id, meal], [fries.id, fries]]),
  addonGroups: new Map([[extras.id, extras]]),
  promotions: [],
  now: new Date('2026-10-07T10:00:00Z'),
  deliveryFee: 0,
  minOrderAmount: 0,
  commissionBps: 500,
  ...over,
});

describe('pricing', () => {
  it('prices 3 sandwiches with variant + addons and computes load units', () => {
    const cart = priceCart([{ productId: 'p1', variantId: 'v1', addonIds: ['a1'], quantity: 3 }, { productId: 'p2', quantity: 2 }], ctx());
    expect(cart.lines[0].lineTotal).toBe(3 * (6000 + 500));
    expect(cart.subtotal).toBe(19500 + 28000);
    expect(cart.loadUnits).toBe(3 * 1 + 2 * 2);
    expect(cart.total).toBe(cart.subtotal);
  });

  it('uses the variant load override', () => {
    expect(priceCart([{ productId: 'p1', variantId: 'v2', quantity: 2 }], ctx()).loadUnits).toBe(4);
  });

  it('matches the commission example from the spec (200 - 20 = 180, 5% → 9, net 171)', () => {
    expect(commissionFor(20000, 2000, 500)).toBe(900);
    const cart = priceCart([{ productId: 'p2', quantity: 1 }, { productId: 'p1', variantId: 'v1', quantity: 1 }], ctx({
      promotions: [promo({ type: 'FIXED', value: 2000, code: 'TWENTY' })],
      promoCode: 'twenty',
    }));
    expect(cart.subtotal).toBe(20000);
    expect(cart.discount).toBe(2000);
    expect(cart.total).toBe(18000);
    expect(cart.commissionAmount).toBe(900);
    expect(cart.merchantNet).toBe(17100);
  });

  it('rejects unavailable products, missing variants and addon limits', () => {
    expect(() => priceCart([{ productId: 'p3', quantity: 1 }], ctx())).toThrow(PricingError);
    expect(() => priceCart([{ productId: 'p1', quantity: 1 }], ctx())).toThrow(/الحجم/);
    expect(() => priceCart([{ productId: 'p1', variantId: 'v1', addonIds: ['a1', 'a2', 'a3'], quantity: 1 }], ctx())).toThrow(/أقصى/);
    expect(() => priceCart([{ productId: 'p2', variantId: 'v1', quantity: 1 }], ctx())).toThrow(PricingError);
    expect(() => priceCart([], ctx())).toThrow(PricingError);
  });

  it('applies promo codes with min subtotal, window, usage limit and cap', () => {
    const lines = [{ productId: 'p2', quantity: 1 }];
    const code = (p: Partial<PromotionRule>) => priceCart(lines, ctx({ promotions: [promo({ code: 'X', ...p })], promoCode: 'x' }));
    expect(code({}).discount).toBe(1400);
    expect(code({ maxDiscount: 1000 }).discount).toBe(1000);
    expect(code({ minSubtotal: 20000 }).promoError?.code).toBe('MIN_SUBTOTAL');
    expect(code({ endsAt: new Date('2026-10-01T00:00:00Z') }).promoError?.code).toBe('EXPIRED');
    expect(code({ usageLimit: 5, usedCount: 5 }).promoError?.code).toBe('USAGE_LIMIT');
    expect(priceCart(lines, ctx({ promoCode: 'NOPE' })).promoError?.code).toBe('INVALID_CODE');
  });

  it('auto-applies the best automatic promotion and supports product discounts', () => {
    const cart = priceCart([{ productId: 'p1', variantId: 'v1', quantity: 2 }, { productId: 'p2', quantity: 1 }], ctx({
      promotions: [
        promo({ id: 'a', autoApply: true, type: 'PRODUCT_FIXED', productId: 'p1', value: 1000 }),
        promo({ id: 'b', autoApply: true, type: 'PERCENT', value: 500 }),
      ],
    }));
    // product: 2 × 10 = 20 EGP vs 5% of 260 = 13 EGP
    expect(cart.discount).toBe(2000);
    expect(cart.promotion?.id).toBe('a');
  });

  it('reports the min-order shortfall', () => {
    const cart = priceCart([{ productId: 'p1', variantId: 'v1', quantity: 1 }], ctx({ minOrderAmount: 10000 }));
    expect(cart.minOrderShortfall).toBe(4000);
  });
});
