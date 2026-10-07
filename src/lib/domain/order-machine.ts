/**
 * Order state machine — the single source of truth for which status changes are legal.
 * Shared by the server (authoritative) and the merchant PWA (optimistic offline updates).
 * Keep this file free of path aliases and runtime dependencies.
 */

export const ORDER_STATUSES = [
  'CREATED', // cash order placed, waiting for the restaurant to accept it
  'AWAITING_PAYMENT', // InstaPay chosen, customer has not reported the transfer yet
  'PAYMENT_REVIEW', // customer reported the transfer, staff must verify it
  'CONFIRMED', // in the kitchen queue (ETA calculated)
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'ARRIVED_AT_GATE',
  'COMPLETED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['INSTAPAY', 'CASH'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  'UNPAID',
  'PAYMENT_SUBMITTED',
  'PAYMENT_VERIFIED',
  'PAYMENT_REJECTED',
  'CASH',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_ACTIONS = [
  'ACCEPT',
  'SUBMIT_PAYMENT',
  'VERIFY_PAYMENT',
  'REJECT_PAYMENT',
  'START_PREPARING',
  'MARK_READY',
  'OUT_FOR_DELIVERY',
  'MARK_ARRIVED',
  'COMPLETE',
  'CANCEL',
] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export type ActorType = 'CUSTOMER' | 'USER' | 'SYSTEM';

/** How the customer gets the food: delivered to a pickup point (default) or collected at the restaurant counter. */
export const FULFILLMENTS = ['DELIVERY', 'PICKUP'] as const;
export type Fulfillment = (typeof FULFILLMENTS)[number];

/** Where the order was placed: the customer's phone (QR) or by staff at the counter. */
export const ORDER_CHANNELS = ['ONLINE', 'COUNTER'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

interface TransitionDef {
  from: readonly OrderStatus[];
  to: OrderStatus;
  /** Permission a staff user needs. */
  permission: string;
  /** Statuses from which the customer (tracking-token holder) may perform this action. */
  customerFrom?: readonly OrderStatus[];
  systemAllowed?: boolean;
}

export const TRANSITIONS: Record<OrderAction, TransitionDef> = {
  ACCEPT: { from: ['CREATED'], to: 'CONFIRMED', permission: 'orders.accept' },
  SUBMIT_PAYMENT: {
    from: ['AWAITING_PAYMENT'],
    to: 'PAYMENT_REVIEW',
    permission: 'payments.verify',
    customerFrom: ['AWAITING_PAYMENT'],
  },
  VERIFY_PAYMENT: { from: ['AWAITING_PAYMENT', 'PAYMENT_REVIEW'], to: 'CONFIRMED', permission: 'payments.verify' },
  REJECT_PAYMENT: { from: ['PAYMENT_REVIEW'], to: 'AWAITING_PAYMENT', permission: 'payments.verify' },
  START_PREPARING: { from: ['CONFIRMED'], to: 'PREPARING', permission: 'orders.kitchen' },
  MARK_READY: { from: ['CONFIRMED', 'PREPARING'], to: 'READY', permission: 'orders.kitchen' },
  OUT_FOR_DELIVERY: { from: ['READY'], to: 'OUT_FOR_DELIVERY', permission: 'orders.delivery' },
  MARK_ARRIVED: { from: ['OUT_FOR_DELIVERY'], to: 'ARRIVED_AT_GATE', permission: 'orders.delivery' },
  COMPLETE: { from: ['OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE'], to: 'COMPLETED', permission: 'orders.delivery' },
  CANCEL: {
    from: ['CREATED', 'AWAITING_PAYMENT', 'PAYMENT_REVIEW', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_GATE'],
    to: 'CANCELLED',
    permission: 'orders.cancel',
    customerFrom: ['CREATED', 'AWAITING_PAYMENT'],
    systemAllowed: true,
  },
};

/** Pickup orders skip the delivery leg: once ready, the counter hands them over directly. */
const PICKUP_OVERRIDES: Partial<Record<OrderAction, TransitionDef | null>> = {
  OUT_FOR_DELIVERY: null,
  MARK_ARRIVED: null,
  COMPLETE: { from: ['READY'], to: 'COMPLETED', permission: 'orders.delivery' },
};

export function transitionFor(action: OrderAction, fulfillment: Fulfillment = 'DELIVERY'): TransitionDef | null {
  if (fulfillment === 'PICKUP' && action in PICKUP_OVERRIDES) return PICKUP_OVERRIDES[action] ?? null;
  return TRANSITIONS[action] ?? null;
}

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];
/** Orders that count toward the kitchen load. */
export const KITCHEN_LOAD_STATUSES: readonly OrderStatus[] = ['CONFIRMED', 'PREPARING'];
/** Orders still in progress (not terminal). */
export const ACTIVE_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s));

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Returns the next status for an action, or null if the transition is not allowed. */
export function nextStatus(current: OrderStatus, action: OrderAction, fulfillment: Fulfillment = 'DELIVERY'): OrderStatus | null {
  const def = transitionFor(action, fulfillment);
  if (!def) return null;
  return def.from.includes(current) ? def.to : null;
}

export function actorMayPerform(
  actor: ActorType,
  action: OrderAction,
  current: OrderStatus,
  hasPermission: (permission: string) => boolean,
  fulfillment: Fulfillment = 'DELIVERY',
): boolean {
  const def = transitionFor(action, fulfillment);
  if (!def) return false;
  if (actor === 'SYSTEM') return def.systemAllowed === true;
  if (actor === 'CUSTOMER') return def.customerFrom?.includes(current) ?? false;
  return hasPermission(def.permission);
}

/** Payment status after an action is applied (null = unchanged). */
export function paymentStatusAfter(
  action: OrderAction,
  method: PaymentMethod,
  current: PaymentStatus,
): PaymentStatus | null {
  switch (action) {
    case 'SUBMIT_PAYMENT':
      return 'PAYMENT_SUBMITTED';
    case 'VERIFY_PAYMENT':
      return 'PAYMENT_VERIFIED';
    case 'REJECT_PAYMENT':
      return 'PAYMENT_REJECTED';
    case 'COMPLETE':
      // Cash is collected at hand-over.
      return method === 'CASH' && current === 'CASH' ? 'PAYMENT_VERIFIED' : null;
    default:
      return null;
  }
}

export function initialStatusFor(method: PaymentMethod): { status: OrderStatus; paymentStatus: PaymentStatus } {
  return method === 'CASH'
    ? { status: 'CREATED', paymentStatus: 'CASH' }
    : { status: 'AWAITING_PAYMENT', paymentStatus: 'UNPAID' };
}

/** The main "next step" button for staff screens, in priority order. */
export function primaryActionFor(status: OrderStatus, fulfillment: Fulfillment = 'DELIVERY'): OrderAction | null {
  switch (status) {
    case 'CREATED':
      return 'ACCEPT';
    case 'AWAITING_PAYMENT':
    case 'PAYMENT_REVIEW':
      return 'VERIFY_PAYMENT';
    case 'CONFIRMED':
      return 'START_PREPARING';
    case 'PREPARING':
      return 'MARK_READY';
    case 'READY':
      return fulfillment === 'PICKUP' ? 'COMPLETE' : 'OUT_FOR_DELIVERY';
    case 'OUT_FOR_DELIVERY':
      return 'MARK_ARRIVED';
    case 'ARRIVED_AT_GATE':
      return 'COMPLETE';
    default:
      return null;
  }
}

/** Timestamp column set when an order enters a status. */
export const STATUS_TIMESTAMP_FIELD: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'confirmedAt',
  PREPARING: 'preparingAt',
  READY: 'readyAt',
  OUT_FOR_DELIVERY: 'outForDeliveryAt',
  ARRIVED_AT_GATE: 'arrivedAt',
  COMPLETED: 'completedAt',
  CANCELLED: 'cancelledAt',
};
