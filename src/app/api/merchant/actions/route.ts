import { requireAuth } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { assertSameOrigin, json, readJson, route } from '@/server/http';
import { log } from '@/server/log';
import { applyOrderAction } from '@/server/services/order-actions';
import { actionsBatchSchema } from '@/lib/validation';
import type { ActionResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PERMANENT = new Set(['INVALID_TRANSITION', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'IDEMPOTENCY_MISMATCH', 'CONFLICT']);

/**
 * Offline outbox flush. Each action is applied exactly once (keyed by its client eventId).
 * Results: applied | duplicate (already applied earlier) | rejected (drop it, server state wins) | retry.
 */
export const POST = route(async (req, _ctx, meta) => {
  assertSameOrigin(req);
  const auth = await requireAuth();
  const body = actionsBatchSchema.parse(await readJson(req, 200_000));
  const results: ActionResult[] = [];
  const blockedOrders = new Set<string>();

  for (const a of body.actions) {
    if (blockedOrders.has(a.orderId)) {
      results.push({ eventId: a.eventId, result: 'retry', code: 'BLOCKED', message: 'Earlier action for this order must sync first' });
      continue;
    }
    try {
      const r = await applyOrderAction({
        orderId: a.orderId,
        action: a.action,
        actor: { type: 'USER', userId: auth.user.id, label: auth.user.name, auth, deviceId: body.deviceId, ip: meta.ip, userAgent: meta.userAgent },
        clientEventId: a.eventId,
        occurredAt: new Date(a.occurredAt),
        payload: a.payload,
        restaurantId: body.restaurantId,
      });
      results.push({ eventId: a.eventId, result: r.result });
    } catch (err) {
      if (err instanceof AppError && PERMANENT.has(err.code)) {
        results.push({ eventId: a.eventId, result: 'rejected', code: err.code, message: err.message });
      } else {
        log.warn('offline_action_retry', { requestId: meta.requestId, eventId: a.eventId, error: String(err) });
        blockedOrders.add(a.orderId);
        results.push({ eventId: a.eventId, result: 'retry', code: 'TRANSIENT' });
      }
    }
  }
  return json({ serverTime: Date.now(), results });
});
