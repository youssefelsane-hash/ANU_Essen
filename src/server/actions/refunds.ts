'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuth } from '../auth/session';
import { AppError } from '../errors';
import { recordRefund, rejectRefundRequest } from '../services/refunds';
import { requestMeta, runAction, str } from './util';
import { parseMoney } from '../../lib/domain/misc';
import type { ActionState } from '../../lib/action-state';

function revalidateOrder(orderId: string) {
  revalidatePath(`/merchant/orders/${orderId}`);
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/merchant/refunds');
}

/** Staff gives money back (full when the amount is left empty). Permission + scope are checked in the service. */
export async function recordRefundAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requireAuth();
    const orderId = z.uuid().parse(str(fd, 'orderId'));
    const rawAmount = str(fd, 'amount');
    const amount = rawAmount ? parseMoney(rawAmount) : undefined;
    if (amount === null) throw new AppError('VALIDATION', 'مبلغ الاسترداد لازم يكون أكبر من صفر ومش أكتر من المتبقي');
    const method = z.enum(['CASH', 'INSTAPAY']).parse(str(fd, 'method'));
    await recordRefund({
      orderId,
      amount,
      method,
      reason: str(fd, 'reason').slice(0, 300) || null,
      reference: str(fd, 'reference').slice(0, 100) || null,
      actor: { userId: auth.user.id, name: auth.user.name, auth, ...(await requestMeta()) },
    });
    revalidateOrder(orderId);
    return 'تم تسجيل الاسترداد';
  });
}

export async function rejectRefundAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requireAuth();
    const refundId = z.uuid().parse(str(fd, 'refundId'));
    const orderId = z.uuid().parse(str(fd, 'orderId'));
    await rejectRefundRequest({
      refundId,
      note: str(fd, 'note').slice(0, 300),
      actor: { userId: auth.user.id, name: auth.user.name, auth, ...(await requestMeta()) },
    });
    revalidateOrder(orderId);
    return 'تم رفض طلب الاسترجاع';
  });
}
