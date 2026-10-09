import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { categories, products, productVariants, restaurants } from '../db/schema';
import { publishedFoodPrice } from '../../lib/domain/customer-pricing';

export interface FoodSearchResult {
  productId: string;
  nameAr: string;
  nameEn: string;
  imageUrl: string | null;
  /** Lowest published (customer) price, piasters. */
  price: number;
  hasSizes: boolean;
  available: boolean;
  restaurant: { slug: string; nameAr: string; nameEn: string; orderingStatus: string };
}

/** Same folding as the in-menu search: hamza forms, alef maqsura, taa marbuta, tatweel, diacritics. */
export function foldArabic(input: string): string {
  return input.toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ـ/g, '').trim();
}

const folded = (col: unknown) => sql`translate(regexp_replace(lower(${col}), '[\\u064B-\\u065F\\u0670]', '', 'g'), 'أإآىةـ', 'ااايه')`;

/** Dishes across every active restaurant, best matches (name before description) first. */
export async function searchFood(d: Db, query: string, limit = 40): Promise<FoodSearchResult[]> {
  const q = foldArabic(query).replace(/[%_\\]/g, '').slice(0, 40);
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const nameHit = sql`(${folded(products.nameAr)} like ${like} or lower(${products.nameEn}) like ${like})`;
  const rows = await d
    .select({
      productId: products.id,
      nameAr: products.nameAr,
      nameEn: products.nameEn,
      imageUrl: products.imageUrl,
      basePrice: products.basePrice,
      isAvailable: products.isAvailable,
      trackStock: products.trackStock,
      stockQty: products.stockQty,
      minVariant: sql<number | null>`(select min(${productVariants.price}) from ${productVariants} where ${productVariants.productId} = ${products.id} and ${productVariants.isAvailable})`,
      variantCount: sql<number>`(select count(*)::int from ${productVariants} where ${productVariants.productId} = ${products.id})`,
      commissionBps: restaurants.commissionBps,
      slug: restaurants.slug,
      restaurantNameAr: restaurants.nameAr,
      restaurantNameEn: restaurants.nameEn,
      orderingStatus: restaurants.orderingStatus,
      nameRank: sql<number>`case when ${nameHit} then 0 else 1 end`,
    })
    .from(products)
    .innerJoin(restaurants, eq(restaurants.id, products.restaurantId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(
      eq(restaurants.isActive, true),
      eq(products.isActive, true),
      eq(categories.isActive, true),
      sql`(${nameHit} or ${folded(products.descriptionAr)} like ${like} or lower(coalesce(${products.descriptionEn}, '')) like ${like})`,
    ))
    .orderBy(sql`case when ${nameHit} then 0 else 1 end`, asc(products.nameAr))
    .limit(limit);
  return rows.map((r) => {
    const raw = r.variantCount > 0 && r.minVariant !== null ? Number(r.minVariant) : r.basePrice;
    return {
      productId: r.productId,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      imageUrl: r.imageUrl,
      price: publishedFoodPrice(raw, r.commissionBps),
      hasSizes: Number(r.variantCount) > 1,
      available: r.isAvailable && (!r.trackStock || r.stockQty > 0) && (Number(r.variantCount) === 0 || r.minVariant !== null),
      restaurant: { slug: r.slug, nameAr: r.restaurantNameAr, nameEn: r.restaurantNameEn, orderingStatus: r.orderingStatus },
    };
  });
}
