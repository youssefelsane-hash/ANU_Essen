import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { rolePermissions } from '../db/schema';
import { AppError } from '../errors';
import { loadAuthz, type AuthContext } from './authz';
import type { AuthzSnapshot } from '../../lib/domain/permissions';

/**
 * Delegation rules for partial platform admins:
 * - nobody hands out platform permissions they don't hold themselves;
 * - nobody changes an account that holds platform permissions they lack.
 */
export function assertCanGrant(auth: AuthzSnapshot, permissions: Iterable<string>) {
  for (const p of permissions) if (!auth.platformPermissions.has(p)) throw new AppError('FORBIDDEN', 'مينفعش تدّي صلاحيات انت نفسك مش عندك');
}

export async function assertCanGrantRole(d: Db, auth: AuthzSnapshot, roleId: string, scope: 'PLATFORM' | 'STORE') {
  if (scope !== 'PLATFORM') return;
  const perms = (await d.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId))).map((r) => r.permissionKey);
  assertCanGrant(auth, perms);
}

export async function assertOutranks(d: Db, auth: AuthContext, targetUserId: string) {
  if (targetUserId === auth.user.id) return;
  const target = await loadAuthz(d, { id: targetUserId, name: '', email: '' });
  if ([...target.platformPermissions].some((p) => !auth.platformPermissions.has(p))) {
    throw new AppError('FORBIDDEN', 'الحساب ده عنده صلاحيات أعلى منك؛ صاحب المنصة بس اللي يعدّله');
  }
}
