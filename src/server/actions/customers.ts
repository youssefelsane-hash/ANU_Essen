'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/session';
import { can } from '../auth/authz';
import { db } from '../db';
import { customers, systemSettings } from '../db/schema';
import { AppError } from '../errors';
import { audit } from '../services/audit';
import { RISK_POLICY_KEY } from '../services/risk';
import { requestMeta, runAction, str } from './util';
import { riskPolicySchema } from '../../lib/domain/risk';
import type { ActionState } from '../../lib/action-state';

async function requireCustomerManager() {
  const auth = await requireAuth();
  if (!can(auth, 'platform.restaurants') && !can(auth, 'platform.support')) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
  return auth;
}

/** Block / unblock a phone from online ordering, or clear its no-show count. */
export async function updateCustomerFlagsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requireCustomerManager();
    const id = z.uuid().parse(str(fd, 'customerId'));
    const op = z.enum(['block', 'unblock', 'reset_no_shows']).parse(str(fd, 'op'));
    const [before] = await db().select().from(customers).where(eq(customers.id, id));
    if (!before) throw new AppError('NOT_FOUND');
    const patch = op === 'block'
      ? { isBlocked: true, blockedReason: str(fd, 'reason').slice(0, 200) || null }
      : op === 'unblock' ? { isBlocked: false, blockedReason: null } : { noShowCount: 0 };
    await db().update(customers).set({ ...patch, updatedAt: new Date() }).where(eq(customers.id, id));
    await audit({ actor: { type: 'USER', userId: auth.user.id, label: auth.user.name }, action: `customer.${op}`, entity: 'customer', entityId: id, before: { isBlocked: before.isBlocked, noShowCount: before.noShowCount }, after: patch, ...(await requestMeta()) });
    revalidatePath('/admin/customers');
    return 'تم الحفظ';
  });
}

export async function saveRiskPolicyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const auth = await requirePermission('platform.settings');
    const policy = riskPolicySchema.parse({ maxOpenOrdersPerPhone: Number(str(fd, 'maxOpenOrdersPerPhone')), noShowCashLimit: Number(str(fd, 'noShowCashLimit')) });
    await db().insert(systemSettings).values({ key: RISK_POLICY_KEY, value: policy, updatedByUserId: auth.user.id })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: policy, updatedAt: new Date(), updatedByUserId: auth.user.id } });
    await audit({ actor: { type: 'USER', userId: auth.user.id, label: auth.user.name }, action: 'settings.risk_policy', entity: 'system_settings', after: policy, ...(await requestMeta()) });
    revalidatePath('/admin/settings');
    return 'تم الحفظ';
  });
}
