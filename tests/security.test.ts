import { describe, expect, it } from 'vitest';
import { safeInternalPath } from '@/lib/domain/misc';
import { hasPermission, PERMISSIONS, SYSTEM_ROLES } from '@/lib/domain/permissions';

describe('post-login redirect', () => {
  it.each([
    ['/admin', '/admin'],
    ['/merchant/orders/1?x=1#y', '/merchant/orders/1?x=1#y'],
    ['//evil.com', null],
    ['/\\evil.com', null],
    ['/\\/evil.com', null],
    ['https://evil.com', null],
    ['javascript:alert(1)', null],
    ['/%0d%0aSet-Cookie:x', '/%0d%0aSet-Cookie:x'],
    ['/\u0000x', null],
    ['', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(safeInternalPath(input as string | null)).toBe(expected);
  });
});

describe('RBAC boundaries', () => {
  it('store roles never carry platform permissions', () => {
    for (const role of SYSTEM_ROLES.filter((r) => r.scope === 'STORE')) {
      expect(role.permissions.filter((p) => PERMISSIONS[p].scope === 'PLATFORM')).toEqual([]);
    }
  });

  it('a store permission only applies inside that restaurant', () => {
    const auth = { platformPermissions: new Set<string>(), storePermissions: new Map([['store-a', new Set(['orders.create'])]]) };
    expect(hasPermission(auth, 'orders.create', 'store-a')).toBe(true);
    expect(hasPermission(auth, 'orders.create', 'store-b')).toBe(false);
    expect(hasPermission(auth, 'orders.create')).toBe(false);
  });

  it('only owner, manager and cashier record counter orders; kitchen and delivery cannot', () => {
    const can = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!.permissions.includes('orders.create');
    expect(['MERCHANT_OWNER', 'MERCHANT_MANAGER', 'CASHIER'].every(can)).toBe(true);
    expect(['KITCHEN_STAFF', 'DELIVERY_STAFF'].some(can)).toBe(false);
  });
});
