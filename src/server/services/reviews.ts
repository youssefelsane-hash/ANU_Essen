import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, isUniqueViolation, type Db } from '../db';
import { orderItems, orders, restaurants, reviewItems, reviews } from '../db/schema';
import { AppError } from '../errors';
import { audit } from './audit';

/** How long after delivery a customer can still rate the order. */
export const REVIEW_WINDOW_DAYS = 7;
/** Averages are shown only once there are enough ratings to mean something. */
export const MIN_RATINGS_SHOWN = 3;

export interface RatingSummary { avg: number; count: number }

export function canReviewOrder(o: { status: string; completedAt: Date | null }, now = new Date()): boolean {
  return o.status === 'COMPLETED' && !!o.completedAt && now.getTime() - o.completedAt.getTime() <= REVIEW_WINDOW_DAYS * 86_400_000;
}

export interface ReviewInput {
  token: string;
  rating: number;
  comment?: string | null;
  items?: { productId: string; rating: number }[];
  now?: Date;
  ip?: string | null;
  userAgent?: string | null;
}

/** Customer rates a delivered order once (bearer: the tracking token). */
export async function submitReview(input: ReviewInput) {
  const now = input.now ?? new Date();
  const [order] = await db().select().from(orders).where(eq(orders.trackingToken, input.token));
  if (!order) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  if (!canReviewOrder(order, now)) throw new AppError('CONFLICT', 'التقييم متاح بعد استلام الطلب ولمدة أسبوع');
  const ordered = new Set((await db().select({ productId: orderItems.productId }).from(orderItems).where(eq(orderItems.orderId, order.id))).map((i) => i.productId).filter(Boolean) as string[]);
  const items = (input.items ?? []).filter((i) => ordered.has(i.productId));
  try {
    return await db().transaction(async (tx) => {
      const [review] = await tx.insert(reviews).values({
        restaurantId: order.restaurantId,
        orderId: order.id,
        rating: input.rating,
        comment: input.comment?.trim() || null,
        customerName: order.customerName.split(/\s+/)[0]?.slice(0, 30) || 'عميل',
        createdAt: now,
      }).returning({ id: reviews.id });
      if (items.length) await tx.insert(reviewItems).values(items.map((i) => ({ reviewId: review.id, productId: i.productId, rating: i.rating })));
      await audit({ actor: { type: 'CUSTOMER', label: 'customer' }, action: 'review.created', entity: 'review', entityId: review.id, restaurantId: order.restaurantId, after: { rating: input.rating, items: items.length }, ip: input.ip, userAgent: input.userAgent }, tx);
      return { reviewId: review.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', 'الطلب ده اتقيّم قبل كده');
    throw err;
  }
}

export async function reviewForOrder(d: Db, orderId: string) {
  const [r] = await d.select({ rating: reviews.rating, comment: reviews.comment, reply: reviews.reply }).from(reviews).where(eq(reviews.orderId, orderId));
  return r ?? null;
}

/** Visible-review averages per restaurant. */
export async function restaurantRatings(d: Db, restaurantIds?: string[]): Promise<Map<string, RatingSummary>> {
  if (restaurantIds && !restaurantIds.length) return new Map();
  const rows = await d.select({ id: reviews.restaurantId, avg: sql<number>`avg(${reviews.rating})::float8`, count: sql<number>`count(*)::int` })
    .from(reviews)
    .where(and(eq(reviews.isHidden, false), ...(restaurantIds ? [inArray(reviews.restaurantId, restaurantIds)] : [])))
    .groupBy(reviews.restaurantId);
  return new Map(rows.map((r) => [r.id, { avg: Math.round(Number(r.avg) * 10) / 10, count: Number(r.count) }]));
}

/** Per-dish averages for one restaurant's menu. */
export async function productRatings(d: Db, restaurantId: string): Promise<Map<string, RatingSummary>> {
  const rows = await d.select({ id: reviewItems.productId, avg: sql<number>`avg(${reviewItems.rating})::float8`, count: sql<number>`count(*)::int` })
    .from(reviewItems)
    .innerJoin(reviews, eq(reviews.id, reviewItems.reviewId))
    .where(and(eq(reviews.restaurantId, restaurantId), eq(reviews.isHidden, false)))
    .groupBy(reviewItems.productId);
  return new Map(rows.map((r) => [r.id, { avg: Math.round(Number(r.avg) * 10) / 10, count: Number(r.count) }]));
}

/** Latest reviews with a comment, for the public menu. */
export async function publicReviews(d: Db, restaurantId: string, limit = 6) {
  return d.select({ id: reviews.id, rating: reviews.rating, comment: reviews.comment, customerName: reviews.customerName, reply: reviews.reply, createdAt: reviews.createdAt })
    .from(reviews)
    .where(and(eq(reviews.restaurantId, restaurantId), eq(reviews.isHidden, false), sql`${reviews.comment} is not null`))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

/** Staff list (restaurant or, with null, every restaurant). */
export async function listReviews(d: Db, restaurantId: string | null, limit = 100) {
  return d.select({
    id: reviews.id, rating: reviews.rating, comment: reviews.comment, customerName: reviews.customerName, isHidden: reviews.isHidden,
    reply: reviews.reply, createdAt: reviews.createdAt, orderId: reviews.orderId, orderNumber: orders.orderNumber,
    restaurantId: reviews.restaurantId, restaurantNameAr: restaurants.nameAr, restaurantNameEn: restaurants.nameEn,
  })
    .from(reviews)
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
    .where(restaurantId ? eq(reviews.restaurantId, restaurantId) : undefined)
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}
