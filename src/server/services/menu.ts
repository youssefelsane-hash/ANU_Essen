import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db';
import {
  addonGroups,
  addons,
  banners,
  categories,
  deliveryPoints,
  productAddonGroups,
  products,
  productVariants,
  promotions,
  restaurantPaymentMethods,
} from '../db/schema';
import type { MenuAddonGroup, MenuProduct, PromotionRule } from '../../lib/domain/pricing';
import type { PublicMenu } from '../../lib/types';
import { publishedFoodPrice } from '../../lib/domain/customer-pricing';
import { getRestaurantBySlug, getStoreLive } from './store';
import { MIN_RATINGS_SHOWN, productRatings, publicReviews, restaurantRatings, type RatingSummary } from './reviews';

export interface MenuCatalog {
  products: Map<string, MenuProduct & { categoryId: string; descriptionAr: string | null; descriptionEn: string | null; imageUrl: string | null; sortOrder: number; showStock: boolean }>;
  addonGroups: Map<string, MenuAddonGroup & { sortOrder: number; isActive: boolean }>;
}

/** Loads the full (small) menu of one restaurant — used for pricing and for the public menu. */
export async function loadMenuCatalog(d: Db, restaurantId: string): Promise<MenuCatalog> {
  const productRows = await d
    .select()
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), eq(products.isActive, true)))
    .orderBy(asc(products.sortOrder), asc(products.nameAr));
  const productIds = productRows.map((p) => p.id);
  const variantRows = productIds.length
    ? await d.select().from(productVariants).where(inArray(productVariants.productId, productIds)).orderBy(asc(productVariants.sortOrder))
    : [];
  const linkRows = productIds.length
    ? await d.select().from(productAddonGroups).where(inArray(productAddonGroups.productId, productIds)).orderBy(asc(productAddonGroups.sortOrder))
    : [];
  const groupRows = await d
    .select()
    .from(addonGroups)
    .where(and(eq(addonGroups.restaurantId, restaurantId), eq(addonGroups.isActive, true)))
    .orderBy(asc(addonGroups.sortOrder));
  const groupIds = groupRows.map((g) => g.id);
  const addonRows = groupIds.length
    ? await d.select().from(addons).where(inArray(addons.groupId, groupIds)).orderBy(asc(addons.sortOrder))
    : [];

  const groupsMap: MenuCatalog['addonGroups'] = new Map();
  for (const g of groupRows) {
    groupsMap.set(g.id, {
      id: g.id,
      nameAr: g.nameAr,
      nameEn: g.nameEn,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      sortOrder: g.sortOrder,
      isActive: g.isActive,
      addons: addonRows
        .filter((a) => a.groupId === g.id)
        .map((a) => ({ id: a.id, nameAr: a.nameAr, nameEn: a.nameEn, price: a.price, isAvailable: a.isAvailable })),
    });
  }

  const productsMap: MenuCatalog['products'] = new Map();
  for (const p of productRows) {
    productsMap.set(p.id, {
      id: p.id,
      categoryId: p.categoryId,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      descriptionAr: p.descriptionAr,
      descriptionEn: p.descriptionEn,
      imageUrl: p.imageUrl,
      basePrice: p.basePrice,
      isAvailable: p.isAvailable,
      isActive: p.isActive,
      prepLoadUnits: p.prepLoadUnits,
      sortOrder: p.sortOrder,
      trackStock: p.trackStock,
      stockQty: p.stockQty,
      showStock: p.showStock,
      variants: variantRows
        .filter((v) => v.productId === p.id)
        .map((v) => ({ id: v.id, nameAr: v.nameAr, nameEn: v.nameEn, price: v.price, isAvailable: v.isAvailable, prepLoadUnits: v.prepLoadUnits })),
      addonGroupIds: linkRows.filter((l) => l.productId === p.id && groupsMap.has(l.groupId)).map((l) => l.groupId),
    });
  }
  return { products: productsMap, addonGroups: groupsMap };
}

/**
 * Active promotions. Personal vouchers (ELSANE prizes) are many and private, so only the one whose
 * code the customer typed is loaded; the phone check happens when the order is placed.
 */
export async function loadPromotionRules(d: Db, restaurantId: string, promoCode?: string | null): Promise<PromotionRule[]> {
  const code = promoCode?.trim().toUpperCase();
  const rows = await d
    .select()
    .from(promotions)
    .where(and(
      eq(promotions.restaurantId, restaurantId),
      eq(promotions.isActive, true),
      code ? or(isNull(promotions.customerPhone), eq(promotions.code, code)) : isNull(promotions.customerPhone),
    ));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    value: p.value,
    productId: p.productId,
    code: p.code,
    autoApply: p.autoApply,
    minSubtotal: p.minSubtotal,
    maxDiscount: p.maxDiscount,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    usageLimit: p.usageLimit,
    usedCount: p.usedCount,
    isActive: p.isActive,
  }));
}

export async function loadPublicMenu(d: Db, slug: string, options: { customerPrices?: boolean; now?: Date } = {}): Promise<PublicMenu | null> {
  const now = options.now ?? new Date();
  const customerPrices = options.customerPrices !== false;
  const r = await getRestaurantBySlug(d, slug);
  // A suspended restaurant still resolves (QR codes keep working) and shows a clear message instead of a 404.
  if (!r) return null;

  const [catalog, categoryRows, bannerRows, methodRows, pointRows, live, ratings, dishRatings, latestReviews] = await Promise.all([
    loadMenuCatalog(d, r.id),
    d.select().from(categories).where(and(eq(categories.restaurantId, r.id), eq(categories.isActive, true))).orderBy(asc(categories.sortOrder)),
    d
      .select()
      .from(banners)
      .where(
        and(
          eq(banners.restaurantId, r.id),
          eq(banners.isActive, true),
          or(isNull(banners.startsAt), lte(banners.startsAt, now)),
          or(isNull(banners.endsAt), gt(banners.endsAt, now)),
        ),
      )
      .orderBy(asc(banners.sortOrder)),
    d
      .select()
      .from(restaurantPaymentMethods)
      .where(and(eq(restaurantPaymentMethods.restaurantId, r.id), eq(restaurantPaymentMethods.isEnabled, true)))
      .orderBy(asc(restaurantPaymentMethods.sortOrder)),
    d
      .select()
      .from(deliveryPoints)
      .where(and(eq(deliveryPoints.restaurantId, r.id), eq(deliveryPoints.isActive, true)))
      .orderBy(asc(deliveryPoints.sortOrder)),
    getStoreLive(d, r, now),
    restaurantRatings(d, [r.id]),
    productRatings(d, r.id),
    publicReviews(d, r.id),
  ]);
  const shown = (x?: RatingSummary) => (x && x.count >= MIN_RATINGS_SHOWN ? x : null);

  const categoryIds = new Set(categoryRows.map((c) => c.id));
  const productsList = [...catalog.products.values()].filter((p) => categoryIds.has(p.categoryId));
  return {
    restaurant: {
      id: r.id,
      slug: r.slug,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      logoUrl: r.logoUrl,
      coverImageUrl: r.coverImageUrl,
      badgeText: r.badgeText,
      badgeTextEn: r.badgeTextEn,
      taglineAr: r.taglineAr,
      taglineEn: r.taglineEn,
      brandColor: r.brandColor,
      phone: r.phone,
      minOrderAmount: customerPrices ? publishedFoodPrice(r.minOrderAmount, r.commissionBps) : r.minOrderAmount,
      requirePhone: r.requirePhone,
      rating: shown(ratings.get(r.id)),
      loyalty: r.loyaltyEnabled ? { reward: r.loyaltyReward, minOrder: customerPrices ? publishedFoodPrice(r.loyaltyMinOrder, r.commissionBps) : r.loyaltyMinOrder } : null,
    },
    reviews: latestReviews.map((x) => ({ ...x, createdAt: x.createdAt.getTime() })),
    store: { status: live.status, reason: live.reason, etaMinutes: live.etaMinutes },
    categories: categoryRows.map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn })),
    products: productsList.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      descriptionAr: p.descriptionAr,
      descriptionEn: p.descriptionEn,
      imageUrl: p.imageUrl,
      basePrice: customerPrices ? publishedFoodPrice(p.basePrice, r.commissionBps) : p.basePrice,
      isAvailable: p.isAvailable && (!p.trackStock || (p.stockQty ?? 0) > 0),
      // The count is shown only when the restaurant chose to; otherwise it stays internal.
      stockLeft: p.trackStock && p.showStock ? Math.max(0, p.stockQty ?? 0) : null,
      rating: shown(dishRatings.get(p.id)),
      variants: p.variants.map((v, i) => ({ id: v.id, nameAr: v.nameAr, nameEn: v.nameEn, price: customerPrices ? publishedFoodPrice(v.price, r.commissionBps) : v.price, isAvailable: v.isAvailable, isDefault: i === 0 })),
      addonGroupIds: p.addonGroupIds,
    })),
    addonGroups: [...catalog.addonGroups.values()].map((g) => ({
      id: g.id,
      nameAr: g.nameAr,
      nameEn: g.nameEn,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      addons: g.addons.map((a) => ({ id: a.id, nameAr: a.nameAr, nameEn: a.nameEn, price: customerPrices ? publishedFoodPrice(a.price, r.commissionBps) : a.price, isAvailable: a.isAvailable })),
    })),
    banners: bannerRows.map((b) => ({ id: b.id, titleAr: b.titleAr, titleEn: b.titleEn, subtitleAr: b.subtitleAr, subtitleEn: b.subtitleEn, imageUrl: b.imageUrl, bgColor: b.bgColor, textColor: b.textColor })),
    paymentMethods: methodRows.map((m) => ({ method: m.method })),
    // Shown fee = what the customer pays for delivery, including a platform courier charge they cover.
    deliveryPoints: pointRows.map((p) => ({ id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, isDefault: p.isDefault, deliveryFee: p.kind === 'PICKUP' ? 0 : p.deliveryFee + (r.platformDeliveryPayer === 'CUSTOMER' ? r.platformDeliveryFee : 0), kind: p.kind })),
  };
}
