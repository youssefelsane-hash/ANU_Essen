import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/errors';
import { initialActionState } from '@/lib/action-state';

const mock = vi.hoisted(() => ({ userId: '', create: vi.fn(), assign: vi.fn(), handIn: vi.fn(), reverse: vi.fn(), meta: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/server/auth/session', () => ({ requireAuth: async () => ({ user: { id: mock.userId, name: 'Current account' } }) }));
vi.mock('@/server/services/couriers', () => ({ createCourier: mock.create, setCourierRestaurants: mock.assign, recordCourierHandIn: mock.handIn, reverseCourierHandIn: mock.reverse }));
vi.mock('next/cache', () => ({ revalidatePath: mock.revalidate }));
vi.mock('@/server/actions/util', () => ({
  requestMeta: mock.meta,
  str: (fd: FormData, key: string) => String(fd.get(key) ?? '').trim(),
  optStr: (fd: FormData, key: string) => String(fd.get(key) ?? '').trim() || null,
  runAction: async (fn: () => Promise<string>) => {
    try { return { ok: true, message: await fn(), at: 1 }; }
    catch (error) { return { ok: false, error: error instanceof AppError ? error.code : 'INTERNAL', at: 1 }; }
  },
}));

import { createCourierAction, setCourierRestaurantsAction, recordCourierHandInAction, reverseCourierHandInAction } from '@/server/actions/couriers';

const actor = '10000000-0000-4000-8000-000000000001';
const another = '10000000-0000-4000-8000-000000000002';
const cases = [
  { label: 'courier creation', action: createCourierAction, service: mock.create },
  { label: 'restaurant assignment', action: setCourierRestaurantsAction, service: mock.assign },
  { label: 'cash hand-in', action: recordCourierHandInAction, service: mock.handIn },
  { label: 'cash reversal', action: reverseCourierHandInAction, service: mock.reverse },
];
function form(actorUserId?: string) {
  const fd = new FormData();
  if (actorUserId) fd.set('actorUserId', actorUserId);
  for (const [key, value] of Object.entries({ name: 'New courier', email: 'courier@test.local', password: 'Local test password', userId: another, restaurantId: another, courierUserId: another, amount: '10.50', idempotencyKey: another, handInId: another, note: 'Receipt correction', restaurantIds: another })) fd.set(key, value);
  return fd;
}
beforeEach(() => { vi.clearAllMocks(); mock.userId = actor; mock.meta.mockResolvedValue({}); });

describe('courier mutation form account binding', () => {
  it.each(cases)('rejects stale $label forms before services or metadata are read', async ({ action }) => {
    mock.userId = another;
    expect(await action(initialActionState, form(actor))).toMatchObject({ ok: false, errorCode: 'UNAUTHENTICATED' });
    for (const entry of cases) expect(entry.service).not.toHaveBeenCalled();
    expect(mock.meta).not.toHaveBeenCalled();
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
  it.each(cases)('rejects an unbound $label form', async ({ action }) => {
    expect(await action(initialActionState, form())).toMatchObject({ ok: false, errorCode: 'UNAUTHENTICATED' });
    for (const entry of cases) expect(entry.service).not.toHaveBeenCalled();
  });
  it.each(cases)('uses the verified current actor for $label', async ({ action, service }) => {
    expect(await action(initialActionState, form(actor))).toMatchObject({ ok: true });
    expect(service).toHaveBeenCalledTimes(1);
    expect(service.mock.calls[0][0].actor.auth.user.id).toBe(actor);
  });
});
