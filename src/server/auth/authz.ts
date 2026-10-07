import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db';
import { rolePermissions, roles, userRoles } from '../db/schema';
import { hasPermission, type AuthzSnapshot } from '../../lib/domain/permissions';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthContext extends AuthzSnapshot {
  user: AuthUser;
  isPlatform: boolean;
  /** Restaurants where the user holds a store role. */
  storeIds: string[];
  roleKeys: string[];
}

/** Loads the user's role assignments and resolves them into permission sets. */
export async function loadAuthz(d: Db, user: AuthUser): Promise<AuthContext> {
  const assignments = await d
    .select({ roleId: userRoles.roleId, restaurantId: userRoles.restaurantId, scope: roles.scope, key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, user.id));

  const roleIds = [...new Set(assignments.map((a) => a.roleId))];
  const perms = roleIds.length
    ? await d.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds))
    : [];
  const permsByRole = new Map<string, string[]>();
  for (const p of perms) permsByRole.set(p.roleId, [...(permsByRole.get(p.roleId) ?? []), p.permissionKey]);

  const platformPermissions = new Set<string>();
  const storePermissions = new Map<string, Set<string>>();
  for (const a of assignments) {
    const granted = permsByRole.get(a.roleId) ?? [];
    if (a.scope === 'PLATFORM') {
      granted.forEach((p) => platformPermissions.add(p));
    } else if (a.restaurantId) {
      const set = storePermissions.get(a.restaurantId) ?? new Set<string>();
      // Store roles can never grant platform permissions, even if misconfigured.
      granted.filter((p) => !p.startsWith('platform.')).forEach((p) => set.add(p));
      storePermissions.set(a.restaurantId, set);
    }
  }
  return {
    user,
    platformPermissions,
    storePermissions,
    isPlatform: platformPermissions.size > 0,
    storeIds: [...storePermissions.keys()],
    roleKeys: [...new Set(assignments.map((a) => a.key))],
  };
}

export function can(auth: AuthzSnapshot | null | undefined, permission: string, restaurantId?: string | null): boolean {
  return !!auth && hasPermission(auth, permission, restaurantId);
}
