'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuth } from '../auth/session';
import { db } from '../db';
import { orders } from '../db/schema';
import { AppError } from '../errors';
import { audit } from '../services/audit';
import { applyOrderAction } from '../services/order-actions';
import { recordNoShow } from '../services/risk';
import { requestMeta, runAction, str } from './util';
import { hasPermission } from '../../lib/domain/permissions';
import type { ActionState } from '../../lib/action-state';

const NO_SHOW_REASON = 'العميل ما استلمش الطلب';

/**
 * The order was ready / at the gate but nobody collected it. Cancels it and counts a no-show on the
 * phone number; repeated no-shows make that number pay by InstaPay (Admin → Settings → protection).
 */
export async function markNoShowAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requireAuth();
    const orderId = z.uuid().parse(str(fd, 'orderId'));
    const [order] = await db().select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
    if (!hasPermission(auth, 'orders.cancel', order.restaurantId)) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
    if (!['READY', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE'].includes(order.status)) throw new AppError('CONFLICT', 'الخيار ده للطلبات الجاهزة اللي ما اتستلمتش بس');
    const meta = await requestMeta();
    await applyOrderAction({ orderId, action: 'CANCEL', actor: { type: 'USER', userId: auth.user.id, label: auth.user.name, auth, ...meta }, payload: { reason: NO_SHOW_REASON } });
    if (order.customerPhone && order.channel === 'ONLINE') await recordNoShow(db(), order.customerPhone);
    await audit({ actor: { type: 'USER', userId: auth.user.id, label: auth.user.name }, action: 'order.no_show', entity: 'order', entityId: orderId, restaurantId: order.restaurantId, after: { orderNumber: order.orderNumber }, ...meta });
    revalidatePath(`/merchant/orders/${orderId}`);
    revalidatePath(`/admin/orders/${orderId}`);
    return 'تم تسجيل إن العميل ما استلمش';
  });
}
