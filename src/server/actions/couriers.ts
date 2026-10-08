'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { requireAuth } from '../auth/session';
import { assertRequestActor } from '../auth/request-identity';
import { AppError } from '../errors';
import { createCourier, recordCourierHandIn, reverseCourierHandIn, setCourierRestaurants } from '../services/couriers';
import { optStr, requestMeta, runAction, str } from './util';
import type { ActionState } from '../../lib/action-state';
import { parseMoney } from '../../lib/domain/misc';

export type CourierActionState = ActionState & { errorCode?: string };

/** A definite rejection is distinguishable from an unknown network/server outcome for safe retries. */
async function courierAction(fn: () => Promise<void>): Promise<CourierActionState> {
  let errorCode: string | undefined;
  const state = await runAction(async () => {
    try { await fn(); } catch (err) {
      errorCode = err instanceof AppError ? err.code : err instanceof ZodError ? 'VALIDATION' : 'INTERNAL';
      throw err;
    }
    revalidatePath('/admin/delivery');
    revalidatePath('/merchant/couriers');
    revalidatePath('/merchant/dashboard');
    return 'Saved';
  });
  return state.ok ? state : { ...state, errorCode: errorCode ?? 'INTERNAL' };
}

export async function createCourierAction(_prev: ActionState, fd: FormData): Promise<CourierActionState> {
  return courierAction(async () => {
    const auth = await requireAuth();
    assertRequestActor(auth, fd.get('actorUserId'));
    await createCourier({
      email: str(fd, 'email'), name: str(fd, 'name'), password: str(fd, 'password'), phone: optStr(fd, 'phone'),
      restaurantIds: fd.getAll('restaurantIds').map(String), actor: { auth, ...(await requestMeta()) },
    });
    revalidatePath('/admin/users');
  });
}

export async function setCourierRestaurantsAction(_prev: ActionState, fd: FormData): Promise<CourierActionState> {
  return courierAction(async () => {
    const auth = await requireAuth();
    assertRequestActor(auth, fd.get('actorUserId'));
    await setCourierRestaurants({ userId: str(fd, 'userId'), restaurantIds: fd.getAll('restaurantIds').map(String), actor: { auth, ...(await requestMeta()) } });
    revalidatePath(`/admin/users/${str(fd, 'userId')}`);
    revalidatePath('/admin/users');
  });
}

export async function recordCourierHandInAction(_prev: ActionState, fd: FormData): Promise<CourierActionState> {
  return courierAction(async () => {
    const auth = await requireAuth();
    assertRequestActor(auth, fd.get('actorUserId'));
    const amount = parseMoney(str(fd, 'amount'));
    if (amount === null || amount <= 0) throw new AppError('VALIDATION', 'Enter the amount received');
    await recordCourierHandIn({ restaurantId: str(fd, 'restaurantId'), courierUserId: str(fd, 'courierUserId'), amount,
      idempotencyKey: str(fd, 'idempotencyKey'), note: optStr(fd, 'note'), actor: { auth, ...(await requestMeta()) } });
  });
}

export async function reverseCourierHandInAction(_prev: ActionState, fd: FormData): Promise<CourierActionState> {
  return courierAction(async () => {
    const auth = await requireAuth();
    assertRequestActor(auth, fd.get('actorUserId'));
    await reverseCourierHandIn({ handInId: str(fd, 'handInId'), idempotencyKey: str(fd, 'idempotencyKey'), note: str(fd, 'note'), actor: { auth, ...(await requestMeta()) } });
  });
}
