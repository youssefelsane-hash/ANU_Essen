/**
 * Database schema (PostgreSQL 15+). Conventions:
 * - UUID primary keys; human order numbers are display-only.
 * - Money = integer piasters; percentages = basis points (500 = 5%).
 * - All timestamps are timestamptz (UTC); display converts with the restaurant timezone.
 * - Orders snapshot everything needed to render them later (names, prices, commission, delivery point).
 * NOTE: relative imports only (drizzle-kit loads this file directly).
 */
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { FULFILLMENTS, ORDER_CHANNELS, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../../lib/domain/order-machine';
import { PROMOTION_TYPES, PRICING_MODES } from '../../lib/domain/pricing';
import type { WeeklyHours } from '../../lib/domain/hours';
import type { QueueConfig } from '../../lib/domain/queue';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const orderingStatusEnum = pgEnum('ordering_status', ['OPEN', 'PAUSED', 'CLOSED']);
export const roleScopeEnum = pgEnum('role_scope', ['PLATFORM', 'STORE']);
export const promotionTypeEnum = pgEnum('promotion_type', PROMOTION_TYPES);
export const actorTypeEnum = pgEnum('actor_type', ['CUSTOMER', 'USER', 'SYSTEM']);
export const fulfillmentEnum = pgEnum('fulfillment', FULFILLMENTS);
export const pricingModeEnum = pgEnum('pricing_mode', PRICING_MODES);
export const refundStatusEnum = pgEnum('refund_status', ['REQUESTED', 'COMPLETED', 'REJECTED']);
export const orderChannelEnum = pgEnum('order_channel', ORDER_CHANNELS);

// ---------------------------------------------------------------- identity & RBAC

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 of the cookie token — the raw token is never stored. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  scope: roleScopeEnum('scope').notNull(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  scope: roleScopeEnum('scope').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: createdAt(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

// ---------------------------------------------------------------- restaurants

export const restaurants = pgTable('restaurants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  logoUrl: text('logo_url'),
  coverImageUrl: text('cover_image_url'),
  badgeText: text('badge_text'),
  badgeTextEn: text('badge_text_en'),
  taglineAr: text('tagline_ar'),
  taglineEn: text('tagline_en'),
  brandColor: text('brand_color').notNull().default('#163d35'),
  phone: text('phone'),
  timezone: text('timezone').notNull().default('Africa/Cairo'),
  currency: text('currency').notNull().default('EGP'),
  orderingStatus: orderingStatusEnum('ordering_status').notNull().default('OPEN'),
  /** null = no schedule (open whenever ordering_status is OPEN). */
  openingHours: jsonb('opening_hours').$type<WeeklyHours | null>(),
  minOrderAmount: integer('min_order_amount').notNull().default(0),
  commissionBps: integer('commission_bps').notNull().default(500),
  /** Historical configuration only. New COUNTER_NO_FEE orders always have zero platform share. */
  counterCommissionEnabled: boolean('counter_commission_enabled').notNull().default(true),
  requirePhone: boolean('require_phone').notNull().default(true),
  unpaidTimeoutMinutes: integer('unpaid_timeout_minutes').notNull().default(20),
  /** false = service suspended by the platform (no new orders; active orders can still be finished). */
  isActive: boolean('is_active').notNull().default(true),
  suspendedReason: text('suspended_reason'),
  suspendedAt: ts('suspended_at'),
  version: integer('version').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    /** null for platform-scoped roles. */
    restaurantId: uuid('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('user_roles_unique').on(t.userId, t.roleId, t.restaurantId).nullsNotDistinct(),
    index('user_roles_restaurant_idx').on(t.restaurantId),
  ],
);

/** Per-restaurant counters, locked row-wise so order numbers and event cursors are gap-free and commit in order. */
export const storeCounters = pgTable('store_counters', {
  restaurantId: uuid('restaurant_id')
    .primaryKey()
    .references(() => restaurants.id, { onDelete: 'cascade' }),
  orderSeq: integer('order_seq').notNull().default(99),
  eventSeq: bigint('event_seq', { mode: 'number' }).notNull().default(0),
});

export const deliveryPoints = pgTable(
  'delivery_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    description: text('description'),
    /** DELIVERY = we bring it to this point; PICKUP = the customer collects it at the restaurant. */
    kind: fulfillmentEnum('kind').notNull().default('DELIVERY'),
    deliveryFee: integer('delivery_fee').notNull().default(0),
    extraMinutes: integer('extra_minutes').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('delivery_points_restaurant_idx').on(t.restaurantId)],
);

export interface PaymentMethodConfig {
  accountName?: string;
  /** InstaPay address, e.g. name@instapay */
  address?: string;
  phone?: string;
  /** Optional InstaPay payment link (ipn.eg/…) */
  link?: string;
  instructions?: string;
  instructionsEn?: string;
}

export const restaurantPaymentMethods = pgTable(
  'restaurant_payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    method: paymentMethodEnum('method').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    config: jsonb('config').$type<PaymentMethodConfig>().notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [unique('restaurant_payment_method_uq').on(t.restaurantId, t.method)],
);

export const queueConfigs = pgTable('queue_configs', {
  restaurantId: uuid('restaurant_id')
    .primaryKey()
    .references(() => restaurants.id, { onDelete: 'cascade' }),
  config: jsonb('config').$type<QueueConfig>().notNull(),
  updatedAt: updatedAt(),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
});

// ---------------------------------------------------------------- menu

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('categories_restaurant_idx').on(t.restaurantId)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    descriptionAr: text('description_ar'),
    descriptionEn: text('description_en'),
    imageUrl: text('image_url'),
    basePrice: integer('base_price').notNull(),
    isAvailable: boolean('is_available').notNull().default(true),
    /** false = archived (kept for history). */
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Kitchen effort per unit, used by the queue engine. */
    prepLoadUnits: integer('prep_load_units').notNull().default(1),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('products_restaurant_idx').on(t.restaurantId), index('products_category_idx').on(t.categoryId)],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    /** Absolute unit price for this variant. */
    price: integer('price').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Overrides product.prep_load_units when set. */
    prepLoadUnits: integer('prep_load_units'),
  },
  (t) => [index('product_variants_product_idx').on(t.productId)],
);

export const addonGroups = pgTable(
  'addon_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    minSelect: integer('min_select').notNull().default(0),
    maxSelect: integer('max_select').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('addon_groups_restaurant_idx').on(t.restaurantId)],
);

export const addons = pgTable(
  'addons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => addonGroups.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    price: integer('price').notNull().default(0),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('addons_group_idx').on(t.groupId)],
);

export const productAddonGroups = pgTable(
  'product_addon_groups',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => addonGroups.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
);

// ---------------------------------------------------------------- marketing

export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: promotionTypeEnum('type').notNull(),
    value: integer('value').notNull().default(0),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** Upper-case promo code; null = no code (auto-apply or banner only). */
    code: text('code'),
    autoApply: boolean('auto_apply').notNull().default(false),
    minSubtotal: integer('min_subtotal').notNull().default(0),
    maxDiscount: integer('max_discount'),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    usageLimit: integer('usage_limit'),
    usedCount: integer('used_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('promotions_code_uq').on(t.restaurantId, t.code), index('promotions_restaurant_idx').on(t.restaurantId)],
);

export const banners = pgTable(
  'banners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    titleAr: text('title_ar').notNull(),
    titleEn: text('title_en'),
    subtitleAr: text('subtitle_ar'),
    subtitleEn: text('subtitle_en'),
    imageUrl: text('image_url'),
    bgColor: text('bg_color').notNull().default('#ea580c'),
    textColor: text('text_color').notNull().default('#ffffff'),
    promotionId: uuid('promotion_id').references(() => promotions.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('banners_restaurant_idx').on(t.restaurantId)],
);

// ---------------------------------------------------------------- customers & orders

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  name: text('name').notNull(),
  ordersCount: integer('orders_count').notNull().default(0),
  lastOrderAt: ts('last_order_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    orderSeq: integer('order_seq').notNull(),
    orderNumber: text('order_number').notNull(),
    /** Unguessable bearer token for the public tracking page. */
    trackingToken: text('tracking_token').notNull().unique(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'),
    customerNote: text('customer_note'),
    status: orderStatusEnum('status').notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    paymentStatus: paymentStatusEnum('payment_status').notNull(),
    deliveryPointId: uuid('delivery_point_id').references(() => deliveryPoints.id, { onDelete: 'set null' }),
    deliveryPointName: text('delivery_point_name').notNull(),
    fulfillment: fulfillmentEnum('fulfillment').notNull().default('DELIVERY'),
    /** Sum of completed refunds (piasters). */
    refundedTotal: integer('refunded_total').notNull().default(0),
    channel: orderChannelEnum('channel').notNull().default('ONLINE'),
    /** Staff member who entered a counter order. */
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    deliveryPointNameEn: text('delivery_point_name_en'),
    subtotal: integer('subtotal').notNull(),
    discountTotal: integer('discount_total').notNull().default(0),
    deliveryFee: integer('delivery_fee').notNull().default(0),
    total: integer('total').notNull(),
    currency: text('currency').notNull(),
    /** Historical rows are never repriced when the platform switches to customer-funded fees. */
    pricingMode: pricingModeEnum('pricing_mode').notNull().default('LEGACY_COMMISSION'),
    platformFeeAmount: integer('platform_fee_amount').notNull().default(0),
    commissionBps: integer('commission_bps').notNull(),
    commissionAmount: integer('commission_amount').notNull(),
    merchantNet: integer('merchant_net').notNull(),
    loadUnits: integer('load_units').notNull(),
    promotionId: uuid('promotion_id').references(() => promotions.id, { onDelete: 'set null' }),
    promoCode: text('promo_code'),
    estimatedPrepStartAt: ts('estimated_prep_start_at'),
    estimatedReadyAt: ts('estimated_ready_at'),
    estimatedArrivalAt: ts('estimated_arrival_at'),
    etaVersion: integer('eta_version').notNull().default(0),
    confirmedAt: ts('confirmed_at'),
    preparingAt: ts('preparing_at'),
    readyAt: ts('ready_at'),
    outForDeliveryAt: ts('out_for_delivery_at'),
    arrivedAt: ts('arrived_at'),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** utm_source of the QR poster that brought the order. */
    source: text('source'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    unique('orders_restaurant_seq_uq').on(t.restaurantId, t.orderSeq),
    unique('orders_idempotency_uq').on(t.restaurantId, t.idempotencyKey),
    index('orders_restaurant_status_idx').on(t.restaurantId, t.status),
    index('orders_restaurant_created_idx').on(t.restaurantId, t.createdAt),
    index('orders_created_idx').on(t.createdAt),
    index('orders_customer_idx').on(t.customerId),
    index('orders_courier_completed_idx').on(t.restaurantId, t.assignedToUserId, t.completedAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    productNameAr: text('product_name_ar').notNull(),
    productNameEn: text('product_name_en').notNull(),
    variantNameAr: text('variant_name_ar'),
    variantNameEn: text('variant_name_en'),
    unitPrice: integer('unit_price').notNull(),
    addonsPerUnit: integer('addons_per_unit').notNull().default(0),
    quantity: integer('quantity').notNull(),
    lineTotal: integer('line_total').notNull(),
    loadUnitsPerUnit: integer('load_units_per_unit').notNull(),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

export const orderItemAddons = pgTable(
  'order_item_addons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    addonId: uuid('addon_id').references(() => addons.id, { onDelete: 'set null' }),
    groupNameAr: text('group_name_ar').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    price: integer('price').notNull(),
  },
  (t) => [index('order_item_addons_item_idx').on(t.orderItemId)],
);

/**
 * Append-only order event log (timeline + status history + sync feed).
 * `seq` is a per-restaurant, gap-free, commit-ordered cursor used by merchant devices.
 */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    action: text('action'),
    fromStatus: orderStatusEnum('from_status'),
    toStatus: orderStatusEnum('to_status'),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    deviceId: uuid('device_id'),
    /** Client-generated id of an (offline) action — guarantees exactly-once application. */
    clientEventId: uuid('client_event_id').unique(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    occurredAt: ts('occurred_at').notNull(),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
  },
  (t) => [unique('order_events_seq_uq').on(t.restaurantId, t.seq), index('order_events_order_idx').on(t.orderId)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: 'cascade' }),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    method: paymentMethodEnum('method').notNull(),
    status: paymentStatusEnum('status').notNull(),
    amount: integer('amount').notNull(),
    /** Transfer reference typed by the customer (optional). */
    reference: text('reference'),
    submittedAt: ts('submitted_at'),
    verifiedAt: ts('verified_at'),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    rejectedReason: text('rejected_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payments_restaurant_idx').on(t.restaurantId, t.status)],
);

export const paymentAttachments = pgTable('payment_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});

/**
 * Refunds are a ledger: money goes back to the customer outside the platform (InstaPay / cash),
 * staff record it here. A customer can also request one from the tracking page (REQUESTED).
 */
export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: refundStatusEnum('status').notNull(),
    amount: integer('amount').notNull(),
    /** INSTAPAY / CASH — how the money went back. */
    method: paymentMethodEnum('method'),
    /** Customer's reason (request) or staff reason. */
    reason: text('reason'),
    /** Where the customer wants the money (e.g. their InstaPay address / phone). */
    payoutDetails: text('payout_details'),
    /** Staff transfer reference. */
    reference: text('reference'),
    decisionNote: text('decision_note'),
    /** Platform commission given back for this refund (snapshot, piasters). */
    commissionReversed: integer('commission_reversed').notNull().default(0),
    requestedByCustomer: boolean('requested_by_customer').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts('decided_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('refunds_order_idx').on(t.orderId), index('refunds_restaurant_status_idx').on(t.restaurantId, t.status)],
);

/** Physical cash received from a courier. Corrections append an exact reversal; history is immutable. */
export const courierCashEntries = pgTable(
  'courier_cash_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'restrict' }),
    courierUserId: uuid('courier_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    entryKind: text('entry_kind').$type<'HAND_IN' | 'REVERSAL'>().notNull(),
    /** Positive piasters. REVERSAL restores this amount to the courier's outstanding cash. */
    amount: integer('amount').notNull(),
    reversesEntryId: uuid('reverses_entry_id').references((): AnyPgColumn => courierCashEntries.id, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key').notNull().unique(),
    note: text('note'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('courier_cash_entries_reversal_uq').on(t.reversesEntryId),
    index('courier_cash_entries_pair_created_idx').on(t.restaurantId, t.courierUserId, t.createdAt),
    check('courier_cash_entries_positive_amount', sql`${t.amount} > 0`),
    check('courier_cash_entries_kind_valid', sql`(${t.entryKind} = 'HAND_IN' and ${t.reversesEntryId} is null) or (${t.entryKind} = 'REVERSAL' and ${t.reversesEntryId} is not null)`),
  ],
);

/** Images uploaded by restaurants (product photos). Small, compressed on the phone before upload. */
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('media_restaurant_idx').on(t.restaurantId)],
);

export const promotionUsages = pgTable(
  'promotion_usages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    discount: integer('discount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('promotion_usage_uq').on(t.promotionId, t.orderId)],
);

// ---------------------------------------------------------------- finance

/** Commission payments received from a restaurant (money does not flow through the platform yet). */
export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    amountPaid: integer('amount_paid').notNull(),
    periodStart: date('period_start', { mode: 'string' }),
    periodEnd: date('period_end', { mode: 'string' }),
    note: text('note'),
    paidAt: ts('paid_at').notNull().defaultNow(),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('settlements_restaurant_idx').on(t.restaurantId)],
);

// ---------------------------------------------------------------- devices, audit, system

export const devices = pgTable('devices', {
  /** Generated on the device and kept in IndexedDB. */
  id: uuid('id').primaryKey(),
  restaurantId: uuid('restaurant_id')
    .notNull()
    .references(() => restaurants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  label: text('label'),
  userAgent: text('user_agent'),
  /** Last event cursor the device confirmed it persisted locally. */
  lastCursor: bigint('last_cursor', { mode: 'number' }).notNull().default(0),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  createdAt: createdAt(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    restaurantId: uuid('restaurant_id').references(() => restaurants.id, { onDelete: 'set null' }),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    deviceId: text('device_id'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt), index('audit_logs_restaurant_idx').on(t.restaurantId, t.createdAt)],
);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
});

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: ts('window_start').notNull(),
  count: integer('count').notNull(),
});
