'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuth } from '../auth/session';
import { db } from '../db';
import { reviews } from '../db/schema';
import { AppError } from '../errors';
import { audit } from '../services/audit';
import { setTicketStatus, staffReply } from '../services/support';
import { requestMeta, runAction, str } from './util';
import { hasPermission } from '../../lib/domain/permissions';
import type { ActionState } from '../../lib/action-state';

function revalidateSupport(ticketId?: string) {
  revalidatePath('/merchant/support');
  revalidatePath('/admin/support');
  if (ticketId) {
    revalidatePath(`/merchant/support/${ticketId}`);
    revalidatePath(`/admin/support/${ticketId}`);
  }
}

export async function replyTicketAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requireAuth();
    const ticketId = z.uuid().parse(str(fd, 'ticketId'));
    await staffReply({ ticketId, body: str(fd, 'body'), close: str(fd, 'close') === '1', actor: { userId: auth.user.id, name: auth.user.name, auth, ...(await requestMeta()) } });
    revalidateSupport(ticketId);
    return 'تم إرسال الرد';
  });
}

export async function setTicketStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requireAuth();
    const ticketId = z.uuid().parse(str(fd, 'ticketId'));
    await setTicketStatus({ ticketId, status: z.enum(['OPEN', 'CLOSED']).parse(str(fd, 'status')), actor: { userId: auth.user.id, name: auth.user.name, auth } });
    revalidateSupport(ticketId);
    return 'تم الحفظ';
  });
}

/** The restaurant answers a review publicly (shown under it on the menu). */
export async function replyReviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requireAuth();
    const id = z.uuid().parse(str(fd, 'reviewId'));
    const [review] = await db().select().from(reviews).where(eq(reviews.id, id));
    if (!review) throw new AppError('NOT_FOUND');
    if (!hasPermission(auth, 'support.manage', review.restaurantId) && !hasPermission(auth, 'platform.support')) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
    const reply = str(fd, 'reply').slice(0, 500) || null;
    await db().update(reviews).set({ reply, repliedAt: reply ? new Date() : null }).where(eq(reviews.id, id));
    await audit({ actor: { type: 'USER', userId: auth.user.id, label: auth.user.name }, action: 'review.replied', entity: 'review', entityId: id, restaurantId: review.restaurantId, after: { reply }, ...(await requestMeta()) });
    revalidatePath('/merchant/reviews');
    revalidatePath('/admin/reviews');
    return 'تم الحفظ';
  });
}

/** Platform moderation: hide an abusive / irrelevant review (kept for the record, excluded from averages). */
export async function setReviewHiddenAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requireAuth();
    if (!hasPermission(auth, 'platform.support')) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
    const id = z.uuid().parse(str(fd, 'reviewId'));
    const hidden = str(fd, 'hidden') === '1';
    const [review] = await db().update(reviews).set({ isHidden: hidden }).where(eq(reviews.id, id)).returning({ restaurantId: reviews.restaurantId });
    if (!review) throw new AppError('NOT_FOUND');
    await audit({ actor: { type: 'USER', userId: auth.user.id, label: auth.user.name }, action: hidden ? 'review.hidden' : 'review.shown', entity: 'review', entityId: id, restaurantId: review.restaurantId, ...(await requestMeta()) });
    revalidatePath('/admin/reviews');
    return 'تم الحفظ';
  });
}
