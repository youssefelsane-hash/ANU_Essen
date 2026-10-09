import { commissionFor, type PricingMode } from './pricing';
import type { OrderSnapshot } from '../types';

/**
 * Public prices are published as the customer's all-in food prices.  The
 * platform split remains an internal accounting concern, so no rate or fee is
 * returned to customer and restaurant-facing screens.
 */
export function publishedFoodPrice(amount: number, platformRateBps: number): number {
  return amount + Math.round((amount * platformRateBps) / 10_000);
}

export interface CustomerPriceTotals {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  /** Fixed platform fee, the one platform amount shown as its own row ("service fee"). */
  serviceFee: number;
  total: number;
  /** The amount already blended into the published food subtotal. Server-only. */
  addedToFood: number;
}

/**
 * Keeps every customer-facing bill arithmetically complete without exposing a
 * separate platform row. Discounts also reduce the all-in food amount.
 */
export function customerPriceTotals(input: {
  pricingMode?: PricingMode;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  platformFeeAmount?: number;
  platformFeeBps?: number;
  serviceFee?: number;
}): CustomerPriceTotals {
  const applies = input.pricingMode === 'ONLINE_PLATFORM_FEE';
  const serviceFee = input.serviceFee ?? 0;
  if (!applies) {
    return {
      subtotal: input.subtotal,
      discount: input.discount,
      deliveryFee: input.deliveryFee,
      serviceFee,
      total: input.total,
      addedToFood: 0,
    };
  }

  const rate = input.platformFeeBps ?? 0;
  const actual = input.platformFeeAmount ?? 0;
  // The all-in menu price is based on the food value before any promotion.
  // The discount row then includes the all-in saving caused by that promotion.
  const publishedAddition = commissionFor(input.subtotal, 0, rate);
  return {
    subtotal: input.subtotal + publishedAddition,
    discount: input.discount + publishedAddition - actual,
    deliveryFee: input.deliveryFee,
    serviceFee,
    total: input.total,
    addedToFood: publishedAddition,
  };
}

type PricedLine = { quantity: number; lineTotal: number; unitPrice: number; addonsPerUnit: number; addons: { price: number }[] };

/**
 * Allocate an already-hidden all-in amount across line totals deterministically.
 * This makes the visible item total equal the visible food subtotal, including
 * when money rounding leaves a remainder of a few piasters.
 */
export function publishLinePrices<T extends PricedLine>(lines: readonly T[], addedToFood: number, rateBps = 0): T[] {
  if (!addedToFood || !lines.length) return [...lines];
  const base = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (base <= 0) return [...lines];

  const allocations = lines.map((line, index) => {
    const scaled = line.lineTotal * addedToFood;
    return { index, amount: Math.floor(scaled / base), remainder: scaled % base };
  });
  let remaining = addedToFood - allocations.reduce((sum, item) => sum + item.amount, 0);
  for (const item of [...allocations].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining <= 0) break;
    item.amount += 1;
    remaining -= 1;
  }

  return lines.map((line, index) => {
    const addition = allocations[index].amount;
    const addons = line.addons.map((addon) => ({ ...addon, price: publishedFoodPrice(addon.price, rateBps) }));
    const addonsPerUnit = addons.reduce((sum, addon) => sum + addon.price, 0);
    const lineTotal = line.lineTotal + addition;
    // The exact line total owns any remaining piaster after quantity rounding.
    return {
      ...line,
      addons,
      addonsPerUnit,
      unitPrice: publishedFoodPrice(line.unitPrice, rateBps),
      lineTotal,
    };
  });
}

/** Normalize old cached snapshots and platform-print inputs without losing operational data. */
export function redactOrderPricing(order: OrderSnapshot): OrderSnapshot {
  const { pricingMode, platformFeeAmount, platformFeeBps, ...visible } = order;
  const totals = customerPriceTotals({
    pricingMode,
    platformFeeAmount,
    platformFeeBps,
    serviceFee: order.serviceFee,
    subtotal: order.subtotal,
    discount: order.discountTotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
  });
  return {
    ...visible,
    items: publishLinePrices(order.items, totals.addedToFood, pricingMode === 'ONLINE_PLATFORM_FEE' ? platformFeeBps ?? 0 : 0),
    subtotal: totals.subtotal,
    discountTotal: totals.discount,
  };
}
