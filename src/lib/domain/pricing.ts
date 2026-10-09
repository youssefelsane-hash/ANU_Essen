/**
 * Cart pricing, promotions and commission (pure). Money is always integer piasters (1 EGP = 100).
 * The server prices every order with this module; clients only ever display server quotes.
 */

export const PROMOTION_TYPES = ['PERCENT', 'FIXED', 'PRODUCT_PERCENT', 'PRODUCT_FIXED', 'BANNER_ONLY'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

/** Historical orders keep their merchant-funded commission; all new prices declare their mode. */
export const PRICING_MODES = ['LEGACY_COMMISSION', 'ONLINE_PLATFORM_FEE', 'COUNTER_NO_FEE'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export interface MenuVariant {
  id: string;
  nameAr: string;
  nameEn: string;
  price: number;
  isAvailable: boolean;
  prepLoadUnits: number | null;
}
export interface MenuAddon {
  id: string;
  nameAr: string;
  nameEn: string;
  price: number;
  isAvailable: boolean;
}
export interface MenuAddonGroup {
  id: string;
  nameAr: string;
  nameEn: string;
  minSelect: number;
  maxSelect: number;
  addons: MenuAddon[];
}
export interface MenuProduct {
  id: string;
  nameAr: string;
  nameEn: string;
  basePrice: number;
  isAvailable: boolean;
  isActive: boolean;
  prepLoadUnits: number;
  variants: MenuVariant[];
  addonGroupIds: string[];
  /** Optional stock: when tracked, an order may not take more than what is left. */
  trackStock?: boolean;
  stockQty?: number;
}

export interface PromotionRule {
  id: string;
  name: string;
  type: PromotionType;
  /** Basis points for percentage types (1000 = 10%), piasters for fixed types. */
  value: number;
  productId: string | null;
  code: string | null;
  autoApply: boolean;
  minSubtotal: number;
  maxDiscount: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
}

export interface CartLineInput {
  productId: string;
  variantId?: string | null;
  addonIds?: string[];
  quantity: number;
  note?: string | null;
}

export interface PricedAddon {
  id: string;
  groupNameAr: string;
  nameAr: string;
  nameEn: string;
  price: number;
}
export interface PricedLine {
  productId: string;
  variantId: string | null;
  nameAr: string;
  nameEn: string;
  variantNameAr: string | null;
  variantNameEn: string | null;
  unitPrice: number;
  addons: PricedAddon[];
  addonsPerUnit: number;
  quantity: number;
  lineTotal: number;
  loadUnitsPerUnit: number;
  note: string | null;
}

export type PromoErrorCode = 'INVALID_CODE' | 'NOT_STARTED' | 'EXPIRED' | 'MIN_SUBTOTAL' | 'USAGE_LIMIT' | 'NOT_APPLICABLE';

export type DeliveryPayer = 'CUSTOMER' | 'RESTAURANT';

export interface PricedCart {
  pricingMode: PricingMode;
  /** Percentage part of the online platform fee (blended into the published food prices). */
  platformFeeAmount: number;
  platformFeeBps: number;
  /** Fixed platform fee per online order, shown to the customer as a "service fee" row. */
  serviceFee: number;
  /** Platform courier charge; already inside deliveryFee when the customer pays it. */
  platformDeliveryFee: number;
  platformDeliveryPayer: DeliveryPayer | null;
  lines: PricedLine[];
  subtotal: number;
  discount: number;
  promotion: { id: string; name: string; code: string | null } | null;
  promoError: { code: PromoErrorCode; message: string } | null;
  deliveryFee: number;
  total: number;
  loadUnits: number;
  minOrderAmount: number;
  minOrderShortfall: number;
  commissionBps: number;
  commissionAmount: number;
  merchantNet: number;
}

export type PricingErrorCode =
  | 'EMPTY_CART'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_UNAVAILABLE'
  | 'VARIANT_REQUIRED'
  | 'VARIANT_INVALID'
  | 'VARIANT_UNAVAILABLE'
  | 'ADDON_INVALID'
  | 'ADDON_UNAVAILABLE'
  | 'ADDON_LIMIT'
  | 'ADDON_REQUIRED'
  | 'QUANTITY_INVALID'
  | 'STOCK_LIMIT';

export class PricingError extends Error {
  constructor(
    public readonly code: PricingErrorCode,
    message: string,
    public readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

export interface PricingContext {
  /** Explicit for new orders. Omission preserves the legacy pure-pricing contract. */
  pricingMode?: PricingMode;
  products: ReadonlyMap<string, MenuProduct>;
  addonGroups: ReadonlyMap<string, MenuAddonGroup>;
  promotions: readonly PromotionRule[];
  promoCode?: string | null;
  now: Date;
  deliveryFee: number;
  minOrderAmount: number;
  commissionBps: number;
  /** Fixed online platform fee (piasters). */
  serviceFee?: number;
  /** Platform courier charge for this order (0 for pickup / not configured). */
  platformDeliveryFee?: number;
  platformDeliveryPayer?: DeliveryPayer;
}

export const MAX_LINE_QUANTITY = 50;

export function egp(piasters: number): string {
  const v = piasters / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function priceLine(input: CartLineInput, ctx: PricingContext): PricedLine {
  const product = ctx.products.get(input.productId);
  if (!product || !product.isActive) {
    throw new PricingError('PRODUCT_NOT_FOUND', 'منتج في السلة لم يعد موجودًا في المنيو', { productId: input.productId });
  }
  if (!product.isAvailable) {
    throw new PricingError('PRODUCT_UNAVAILABLE', `${product.nameAr} غير متاح حاليًا`, { productId: product.id });
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_LINE_QUANTITY) {
    throw new PricingError('QUANTITY_INVALID', 'الكمية غير صحيحة', { productId: product.id });
  }

  let unitPrice = product.basePrice;
  let loadUnitsPerUnit = product.prepLoadUnits;
  let variant: MenuVariant | null = null;
  if (product.variants.length > 0) {
    if (!input.variantId) throw new PricingError('VARIANT_REQUIRED', `اختر الحجم لـ ${product.nameAr}`, { productId: product.id });
    variant = product.variants.find((v) => v.id === input.variantId) ?? null;
    if (!variant) throw new PricingError('VARIANT_INVALID', `الحجم المختار غير موجود لـ ${product.nameAr}`, { productId: product.id });
    if (!variant.isAvailable) {
      throw new PricingError('VARIANT_UNAVAILABLE', `${product.nameAr} (${variant.nameAr}) غير متاح حاليًا`, { productId: product.id });
    }
    unitPrice = variant.price;
    loadUnitsPerUnit = variant.prepLoadUnits ?? product.prepLoadUnits;
  } else if (input.variantId) {
    throw new PricingError('VARIANT_INVALID', `الحجم المختار غير موجود لـ ${product.nameAr}`, { productId: product.id });
  }

  const addonIds = [...new Set(input.addonIds ?? [])];
  const addons: PricedAddon[] = [];
  const perGroup = new Map<string, number>();
  for (const addonId of addonIds) {
    let found: { group: MenuAddonGroup; addon: MenuAddon } | null = null;
    for (const groupId of product.addonGroupIds) {
      const group = ctx.addonGroups.get(groupId);
      const addon = group?.addons.find((a) => a.id === addonId);
      if (group && addon) {
        found = { group, addon };
        break;
      }
    }
    if (!found) throw new PricingError('ADDON_INVALID', `إضافة غير صحيحة لـ ${product.nameAr}`, { productId: product.id, addonId });
    if (!found.addon.isAvailable) {
      throw new PricingError('ADDON_UNAVAILABLE', `${found.addon.nameAr} غير متاحة حاليًا`, { productId: product.id, addonId });
    }
    perGroup.set(found.group.id, (perGroup.get(found.group.id) ?? 0) + 1);
    addons.push({ id: found.addon.id, groupNameAr: found.group.nameAr, nameAr: found.addon.nameAr, nameEn: found.addon.nameEn, price: found.addon.price });
  }
  for (const groupId of product.addonGroupIds) {
    const group = ctx.addonGroups.get(groupId);
    if (!group) continue;
    const count = perGroup.get(groupId) ?? 0;
    if (group.maxSelect > 0 && count > group.maxSelect) {
      throw new PricingError('ADDON_LIMIT', `أقصى عدد من ${group.nameAr} هو ${group.maxSelect}`, { productId: product.id, groupId });
    }
    if (count < group.minSelect) {
      throw new PricingError('ADDON_REQUIRED', `اختر ${group.nameAr} لـ ${product.nameAr}`, { productId: product.id, groupId });
    }
  }

  const addonsPerUnit = addons.reduce((sum, a) => sum + a.price, 0);
  return {
    productId: product.id,
    variantId: variant?.id ?? null,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    variantNameAr: variant?.nameAr ?? null,
    variantNameEn: variant?.nameEn ?? null,
    unitPrice,
    addons,
    addonsPerUnit,
    quantity: input.quantity,
    lineTotal: (unitPrice + addonsPerUnit) * input.quantity,
    loadUnitsPerUnit,
    note: input.note?.trim() || null,
  };
}

export function promotionIneligibility(promo: PromotionRule, subtotal: number, now: Date): PromoErrorCode | null {
  if (!promo.isActive || promo.type === 'BANNER_ONLY') return 'NOT_APPLICABLE';
  if (promo.startsAt && now < promo.startsAt) return 'NOT_STARTED';
  if (promo.endsAt && now >= promo.endsAt) return 'EXPIRED';
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) return 'USAGE_LIMIT';
  if (subtotal < promo.minSubtotal) return 'MIN_SUBTOTAL';
  return null;
}

export function promotionDiscount(promo: PromotionRule, lines: readonly PricedLine[], subtotal: number): number {
  let discount = 0;
  switch (promo.type) {
    case 'PERCENT':
      discount = Math.floor((subtotal * promo.value) / 10_000);
      break;
    case 'FIXED':
      discount = promo.value;
      break;
    case 'PRODUCT_PERCENT':
      for (const l of lines) if (l.productId === promo.productId) discount += Math.floor((l.unitPrice * l.quantity * promo.value) / 10_000);
      break;
    case 'PRODUCT_FIXED':
      for (const l of lines) if (l.productId === promo.productId) discount += Math.min(promo.value, l.unitPrice) * l.quantity;
      break;
    case 'BANNER_ONLY':
      discount = 0;
  }
  if (promo.maxDiscount !== null && promo.maxDiscount >= 0) discount = Math.min(discount, promo.maxDiscount);
  return Math.max(0, Math.min(discount, subtotal));
}

function promoErrorMessage(code: PromoErrorCode): string {
  switch (code) {
    case 'INVALID_CODE':
      return 'الكود غير صحيح';
    case 'NOT_STARTED':
      return 'الكود لم يبدأ بعد';
    case 'EXPIRED':
      return 'الكود منتهي';
    case 'USAGE_LIMIT':
      return 'الكود استُخدم بالكامل';
    case 'MIN_SUBTOTAL':
      return 'قيمة طلبك أقل من الحد الأدنى للعرض. ضيف أصناف وجرب الكود تاني.';
    case 'NOT_APPLICABLE':
      return 'الكود لا ينطبق على طلبك';
  }
}

export function commissionFor(subtotal: number, discount: number, commissionBps: number): number {
  return Math.round((Math.max(0, subtotal - discount) * commissionBps) / 10_000);
}

export function priceCart(input: readonly CartLineInput[], ctx: PricingContext): PricedCart {
  if (input.length === 0) throw new PricingError('EMPTY_CART', 'السلة فاضية');
  const lines = input.map((l) => priceLine(l, ctx));
  // Stock is per product (all sizes share it), so add up every line of the same product.
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
  for (const [productId, quantity] of wanted) {
    const product = ctx.products.get(productId);
    if (product?.trackStock && quantity > (product.stockQty ?? 0)) {
      const left = Math.max(0, product.stockQty ?? 0);
      throw new PricingError(left ? 'STOCK_LIMIT' : 'PRODUCT_UNAVAILABLE', left ? `متبقي ${left} بس من ${product.nameAr}` : `${product.nameAr} غير متاح حاليًا`, { productId, left });
    }
  }
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const loadUnits = lines.reduce((s, l) => s + l.loadUnitsPerUnit * l.quantity, 0);

  type Candidate = { promo: PromotionRule; discount: number };
  const candidates: Candidate[] = [];
  for (const promo of ctx.promotions) {
    if (!promo.autoApply || promo.code) continue;
    if (promotionIneligibility(promo, subtotal, ctx.now)) continue;
    const discount = promotionDiscount(promo, lines, subtotal);
    if (discount > 0) candidates.push({ promo, discount });
  }

  let promoError: PricedCart['promoError'] = null;
  const code = ctx.promoCode?.trim().toUpperCase();
  if (code) {
    const promo = ctx.promotions.find((p) => p.code?.toUpperCase() === code);
    if (!promo) {
      promoError = { code: 'INVALID_CODE', message: promoErrorMessage('INVALID_CODE') };
    } else {
      const reason = promotionIneligibility(promo, subtotal, ctx.now);
      const discount = reason ? 0 : promotionDiscount(promo, lines, subtotal);
      if (reason) promoError = { code: reason, message: promoErrorMessage(reason) };
      else if (discount <= 0) promoError = { code: 'NOT_APPLICABLE', message: promoErrorMessage('NOT_APPLICABLE') };
      else candidates.push({ promo, discount });
    }
  }

  const best = candidates.sort((a, b) => b.discount - a.discount)[0] ?? null;
  const discount = best?.discount ?? 0;
  const pricingMode = ctx.pricingMode ?? 'LEGACY_COMMISSION';
  const commissionBps = pricingMode === 'COUNTER_NO_FEE' ? 0 : ctx.commissionBps;
  const percentCommission = commissionFor(subtotal, discount, commissionBps);
  // The online fee is calculated once on discounted food + extras, never on delivery.
  const platformFeeAmount = pricingMode === 'ONLINE_PLATFORM_FEE' ? percentCommission : 0;
  const serviceFee = pricingMode === 'ONLINE_PLATFORM_FEE' ? Math.max(0, ctx.serviceFee ?? 0) : 0;
  // Platform couriers: the charge is either added to the bill or taken from the restaurant's share.
  const platformDeliveryFee = Math.max(0, ctx.platformDeliveryFee ?? 0);
  const platformDeliveryPayer = platformDeliveryFee > 0 ? (ctx.platformDeliveryPayer ?? 'CUSTOMER') : null;
  const deliveryFee = ctx.deliveryFee + (platformDeliveryPayer === 'CUSTOMER' ? platformDeliveryFee : 0);
  const total = subtotal - discount + deliveryFee + platformFeeAmount + serviceFee;
  // Everything the platform is owed for this order: percentage + fixed fee + courier charge.
  const commissionAmount = percentCommission + serviceFee + platformDeliveryFee;

  return {
    pricingMode,
    platformFeeAmount,
    platformFeeBps: pricingMode === 'ONLINE_PLATFORM_FEE' ? commissionBps : 0,
    serviceFee,
    platformDeliveryFee,
    platformDeliveryPayer,
    lines,
    subtotal,
    discount,
    promotion: best ? { id: best.promo.id, name: best.promo.name, code: best.promo.code } : null,
    promoError,
    deliveryFee,
    total,
    loadUnits,
    minOrderAmount: ctx.minOrderAmount,
    minOrderShortfall: Math.max(0, ctx.minOrderAmount - subtotal),
    commissionBps,
    commissionAmount,
    merchantNet: total - commissionAmount,
  };
}
