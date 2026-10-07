import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { orders, queueConfigs, restaurants, systemSettings } from '../db/schema';
import { KITCHEN_LOAD_STATUSES } from '../../lib/domain/order-machine';
import {
  DEFAULT_QUEUE_CONFIG,
  estimateTotalMinutes,
  loadLevel,
  queueConfigSchema,
  tierCeiling,
  type QueueConfig,
} from '../../lib/domain/queue';
import { computeEffectiveStatus } from '../../lib/domain/store-status';
import type { StoreLive } from '../../lib/types';

export type RestaurantRow = typeof restaurants.$inferSelect;

export async function getRestaurantBySlug(d: Db, slug: string): Promise<RestaurantRow | null> {
  const [r] = await d.select().from(restaurants).where(eq(restaurants.slug, slug.toLowerCase()));
  return r ?? null;
}

export async function getRestaurant(d: Db, id: string): Promise<RestaurantRow | null> {
  const [r] = await d.select().from(restaurants).where(eq(restaurants.id, id));
  return r ?? null;
}

/** Platform default queue config (system setting) used for new restaurants. */
export async function getDefaultQueueConfig(d: Db): Promise<QueueConfig> {
  const [row] = await d.select().from(systemSettings).where(eq(systemSettings.key, 'defaults.queue'));
  const parsed = queueConfigSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_QUEUE_CONFIG;
}

export async function getQueueConfig(d: Db, restaurantId: string): Promise<QueueConfig> {
  const [row] = await d.select().from(queueConfigs).where(eq(queueConfigs.restaurantId, restaurantId));
  const parsed = queueConfigSchema.safeParse(row?.config);
  return parsed.success ? parsed.data : getDefaultQueueConfig(d);
}

/** Active kitchen load = sum of load units of orders in CONFIRMED/PREPARING. */
export async function getActiveLoad(d: Db, restaurantId: string, excludeOrderId?: string): Promise<{ load: number; count: number }> {
  const conditions = [eq(orders.restaurantId, restaurantId), inArray(orders.status, [...KITCHEN_LOAD_STATUSES])];
  if (excludeOrderId) conditions.push(ne(orders.id, excludeOrderId));
  const [row] = await d
    .select({ load: sql<number>`coalesce(sum(${orders.loadUnits}), 0)::int`, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(...conditions));
  return { load: Number(row?.load ?? 0), count: Number(row?.count ?? 0) };
}

export async function getStoreLive(d: Db, r: RestaurantRow, now = new Date()): Promise<StoreLive & { config: QueueConfig }> {
  const config = await getQueueConfig(d, r.id);
  const { load, count } = await getActiveLoad(d, r.id);
  const { status, reason } = computeEffectiveStatus({
    isActive: r.isActive,
    orderingStatus: r.orderingStatus,
    openingHours: r.openingHours ?? null,
    timezone: r.timezone,
    now,
    load,
    activeOrders: count,
    queue: config,
  });
  return {
    status,
    reason,
    orderingStatus: r.orderingStatus,
    load,
    activeOrders: count,
    level: loadLevel(load, config, count),
    tierMax: tierCeiling(load, config),
    maxLoad: config.maxAcceptedLoad,
    etaMinutes: estimateTotalMinutes(load, config),
    config,
  };
}

export function closedMessage(status: string, reason?: string | null): string {
  if (reason === 'INACTIVE') return 'الطلب أونلاين من المطعم ده متوقف مؤقتًا';
  return status === 'PAUSED' ? 'الطلبات متوقفة مؤقتًا بسبب ضغط الطلبات' : 'المحل مغلق حاليًا';
}
