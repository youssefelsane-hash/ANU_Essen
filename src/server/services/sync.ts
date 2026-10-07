import { and, asc, desc, eq, gt, gte, inArray } from 'drizzle-orm';
import { db } from '../db';
import { devices, orderEvents, orders, storeCounters } from '../db/schema';
import { AppError } from '../errors';
import type { AuthContext } from '../auth/authz';
import { ACTIVE_STATUSES } from '../../lib/domain/order-machine';
import { hasPermission } from '../../lib/domain/permissions';
import type { SyncResponse } from '../../lib/types';
import { expireUnpaidOrders } from './order-actions';
import { loadOrderSnapshots } from './order-views';
import { getRestaurant, getStoreLive } from './store';

const EVENT_PAGE = 500;
const BOOTSTRAP_HOURS = 16;

/**
 * Reliable pull-sync for merchant devices: "give me every order that changed after cursor X".
 * The cursor is the per-restaurant event sequence, allocated under a row lock so it is gap-free and
 * commit-ordered — a device can never skip an event, even if a realtime push was missed.
 */
export async function merchantSync(params: {
  auth: AuthContext;
  restaurantId: string;
  deviceId: string;
  cursor: number;
  userAgent?: string | null;
}): Promise<SyncResponse> {
  const { auth, restaurantId, deviceId } = params;
  const canViewAll = hasPermission(auth, 'orders.view', restaurantId);
  const isDelivery = hasPermission(auth, 'orders.delivery', restaurantId);
  if (!canViewAll && !isDelivery) throw new AppError('FORBIDDEN', 'No access to this restaurant orders');

  const d = db();
  const restaurant = await getRestaurant(d, restaurantId);
  if (!restaurant) throw new AppError('NOT_FOUND', 'Restaurant not found');

  await expireUnpaidOrders(restaurantId, restaurant.unpaidTimeoutMinutes);

  // The device reports the cursor it has durably stored — this doubles as a delivery acknowledgement.
  await d
    .insert(devices)
    .values({ id: deviceId, restaurantId, userId: auth.user.id, userAgent: params.userAgent?.slice(0, 300) ?? null, lastCursor: params.cursor })
    .onConflictDoUpdate({
      target: devices.id,
      set: { restaurantId, userId: auth.user.id, lastCursor: params.cursor, lastSeenAt: new Date() },
    });

  const [counter] = await d.select({ eventSeq: storeCounters.eventSeq }).from(storeCounters).where(eq(storeCounters.restaurantId, restaurantId));
  const head = counter?.eventSeq ?? 0;

  let orderIds: string[];
  let cursor: number;
  let hasMore = false;
  let reset = false;

  if (params.cursor <= 0 || params.cursor > head) {
    // Bootstrap (or the server was reset): active orders + recent history, then continue from head.
    reset = true;
    cursor = head;
    const since = new Date(Date.now() - BOOTSTRAP_HOURS * 3_600_000);
    const [active, recent] = await Promise.all([
      d.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.restaurantId, restaurantId), inArray(orders.status, [...ACTIVE_STATUSES]))),
      d.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.restaurantId, restaurantId), gte(orders.createdAt, since)))
        .orderBy(desc(orders.createdAt)).limit(300),
    ]);
    orderIds = [...new Set([...active, ...recent].map((r) => r.id))];
  } else {
    const events = await d
      .select({ seq: orderEvents.seq, orderId: orderEvents.orderId })
      .from(orderEvents)
      .where(and(eq(orderEvents.restaurantId, restaurantId), gt(orderEvents.seq, params.cursor)))
      .orderBy(asc(orderEvents.seq))
      .limit(EVENT_PAGE);
    cursor = events.length ? events[events.length - 1].seq : params.cursor;
    hasMore = events.length === EVENT_PAGE;
    orderIds = [...new Set(events.map((e) => e.orderId))];
  }

  const includePhone = ['orders.accept', 'payments.verify', 'orders.delivery'].some((p) => hasPermission(auth, p, restaurantId));
  const snapshots = await loadOrderSnapshots(d, orderIds, { includePhone });

  let visible = snapshots;
  const removed: string[] = [];
  if (!canViewAll) {
    // Delivery staff: orders ready for pickup + the deliveries they took.
    visible = snapshots.filter(
      (o) =>
        o.status === 'READY' ||
        (o.assignedToUserId === auth.user.id && ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE', 'COMPLETED'].includes(o.status)),
    );
    for (const o of snapshots) if (!visible.includes(o)) removed.push(o.id);
  }

  const live = await getStoreLive(d, restaurant);
  const { config: _config, ...store } = live;
  return { serverTime: Date.now(), cursor, hasMore, reset, orders: visible, removed, store };
}
