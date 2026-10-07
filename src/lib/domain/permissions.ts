/**
 * RBAC catalogue. Permissions and system roles are synced into the DB by the seed;
 * authorization always reads role→permission mappings from the DB, so custom roles work.
 */

export type PermissionScope = 'PLATFORM' | 'STORE';

export const PERMISSIONS = {
  // Platform (super admin) — never granted through store roles.
  'platform.restaurants': { scope: 'PLATFORM', description: 'Create and configure restaurants, payment settings, delivery points' },
  'platform.queue': { scope: 'PLATFORM', description: 'Edit queue / capacity / ETA engine configuration' },
  'platform.finance': { scope: 'PLATFORM', description: 'View global sales, platform commission and settlements' },
  'platform.users': { scope: 'PLATFORM', description: 'Manage all users, roles and permissions' },
  'platform.audit': { scope: 'PLATFORM', description: 'View all audit logs' },
  'platform.settings': { scope: 'PLATFORM', description: 'Edit system settings' },
  // Store scoped.
  'orders.view': { scope: 'STORE', description: 'See all orders of the restaurant' },
  'orders.accept': { scope: 'STORE', description: 'Accept cash orders' },
  'orders.create': { scope: 'STORE', description: 'Create orders at the counter (walk-in customers)' },
  'orders.kitchen': { scope: 'STORE', description: 'Start preparing / mark ready' },
  'orders.delivery': { scope: 'STORE', description: 'Out for delivery / arrived / completed' },
  'orders.cancel': { scope: 'STORE', description: 'Cancel orders' },
  'payments.verify': { scope: 'STORE', description: 'Verify or reject InstaPay transfers' },
  'receipts.print': { scope: 'STORE', description: 'Print and reprint receipts' },
  'menu.availability': { scope: 'STORE', description: 'Toggle product availability' },
  'menu.manage': { scope: 'STORE', description: 'Edit menu, prices, banners and promotions' },
  'store.status': { scope: 'STORE', description: 'Open / pause / close ordering' },
  'staff.manage': { scope: 'STORE', description: 'Manage restaurant staff accounts' },
  'reports.view': { scope: 'STORE', description: 'See restaurant sales reports and order history' },
  'audit.view': { scope: 'STORE', description: 'See audit logs of the restaurant' },
} as const satisfies Record<string, { scope: PermissionScope; description: string }>;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export const STORE_PERMISSIONS = ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].scope === 'STORE');

export interface SystemRoleDef {
  key: string;
  name: string;
  scope: PermissionScope;
  description: string;
  permissions: readonly Permission[];
}

export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin (Platform Owner)',
    scope: 'PLATFORM',
    description: 'Full access to everything on the platform.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'MERCHANT_OWNER',
    name: 'Merchant Owner',
    scope: 'STORE',
    description: 'Restaurant owner: orders, sales, menu, staff, payments of their own restaurant.',
    permissions: STORE_PERMISSIONS,
  },
  {
    key: 'MERCHANT_MANAGER',
    name: 'Merchant Manager',
    scope: 'STORE',
    description: 'Runs daily operations.',
    permissions: [
      'orders.view',
      'orders.accept',
      'orders.create',
      'orders.kitchen',
      'orders.delivery',
      'orders.cancel',
      'payments.verify',
      'receipts.print',
      'menu.availability',
      'store.status',
      'reports.view',
    ],
  },
  {
    key: 'CASHIER',
    name: 'Cashier / Order Operator',
    scope: 'STORE',
    description: 'Orders, payment verification and receipts.',
    permissions: ['orders.view', 'orders.accept', 'orders.create', 'orders.delivery', 'payments.verify', 'receipts.print'],
  },
  {
    key: 'KITCHEN_STAFF',
    name: 'Kitchen Staff',
    scope: 'STORE',
    description: 'Only what the kitchen needs.',
    permissions: ['orders.view', 'orders.kitchen', 'receipts.print'],
  },
  {
    key: 'DELIVERY_STAFF',
    name: 'Delivery Staff',
    scope: 'STORE',
    description: 'Sees ready orders and the deliveries they took.',
    permissions: ['orders.delivery'],
  },
];

/** Roles that only a platform admin may assign. */
export const PROTECTED_ROLE_KEYS = ['SUPER_ADMIN', 'MERCHANT_OWNER'];

export interface AuthzSnapshot {
  platformPermissions: ReadonlySet<string>;
  storePermissions: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Platform roles grant permissions globally; store roles only inside their restaurant. */
export function hasPermission(auth: AuthzSnapshot, permission: string, restaurantId?: string | null): boolean {
  if (auth.platformPermissions.has(permission)) return true;
  if (!restaurantId) return false;
  return auth.storePermissions.get(restaurantId)?.has(permission) ?? false;
}
