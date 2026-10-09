/** DTOs shared by the server and the browser apps. Dates travel as epoch milliseconds. */
import type { Fulfillment, OrderAction, OrderChannel, OrderStatus, PaymentMethod, PaymentStatus } from './domain/order-machine';
import type { PricingMode } from './domain/pricing';
import type { LoadLevel } from './domain/queue';
import type { EffectiveStatus, StatusReason } from './domain/store-status';

export interface SnapshotItem {
  id: string;
  /** Menu product (null when it was deleted later). */
  productId?: string | null;
  nameAr: string;
  nameEn: string;
  variantNameAr: string | null;
  variantNameEn?: string | null;
  quantity: number;
  unitPrice: number;
  addonsPerUnit: number;
  lineTotal: number;
  addons: { nameAr: string; nameEn?: string; price: number }[];
  note: string | null;
}

export interface TimelineEntry {
  type: string;
  action: string | null;
  toStatus: OrderStatus | null;
  occurredAt: number;
  actor: string;
  note?: string | null;
}

export type RefundStatus = 'REQUESTED' | 'COMPLETED' | 'REJECTED';

export interface RefundView {
  id: string;
  status: RefundStatus;
  amount: number;
  method: PaymentMethod | null;
  reason: string | null;
  /** Where the customer wants the money (InstaPay address / wallet). Staff only. */
  payoutDetails?: string | null;
  reference: string | null;
  decisionNote: string | null;
  requestedByCustomer: boolean;
  createdAt: number;
  decidedAt: number | null;
}

/** Everything a merchant device needs to run an order fully offline (also used for receipts). */
export interface OrderSnapshot {
  id: string;
  restaurantId: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentReference: string | null;
  paymentRejectedReason: string | null;
  hasPaymentAttachment: boolean;
  customerName: string;
  customerPhone: string | null;
  customerNote: string | null;
  deliveryPointName: string;
  deliveryPointNameEn?: string | null;
  fulfillment: Fulfillment;
  channel: OrderChannel;
  items: SnapshotItem[];
  pricingMode?: PricingMode;
  platformFeeAmount?: number;
  platformFeeBps?: number;
  /** Fixed online service fee shown on the bill (part of total). */
  serviceFee?: number;
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  currency: string;
  promoCode: string | null;
  loadUnits: number;
  estimatedReadyAt: number | null;
  estimatedArrivalAt: number | null;
  createdAt: number;
  confirmedAt: number | null;
  preparingAt: number | null;
  readyAt: number | null;
  outForDeliveryAt: number | null;
  arrivedAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
  cancelReason: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  timeline: TimelineEntry[];
  /** Optional: snapshots cached on devices before refunds existed lack these. */
  refundedTotal?: number;
  refunds?: RefundView[];
  version: number;
}

export interface StoreLive {
  status: EffectiveStatus;
  reason: StatusReason;
  orderingStatus: 'OPEN' | 'PAUSED' | 'CLOSED';
  load: number;
  activeOrders: number;
  level: LoadLevel;
  tierMax: number | null;
  maxLoad: number;
  etaMinutes: number;
}

export interface SyncResponse {
  serverTime: number;
  cursor: number;
  hasMore: boolean;
  reset: boolean;
  orders: OrderSnapshot[];
  removed: string[];
  store: StoreLive;
}

export interface OfflineAction {
  eventId: string;
  orderId: string;
  action: OrderAction;
  /** Client clock corrected by the server offset (epoch ms). */
  occurredAt: number;
  payload?: { reason?: string };
}

export type ActionResultKind = 'applied' | 'duplicate' | 'rejected' | 'retry';
export interface ActionResult {
  eventId: string;
  result: ActionResultKind;
  code?: string;
  message?: string;
}

export interface TrackingView {
  serverTime: number;
  order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
    paymentReference: string | null;
    paymentRejectedReason: string | null;
    customerName: string;
    deliveryPointName: string;
    deliveryPointNameEn?: string | null;
    fulfillment: Fulfillment;
    items: SnapshotItem[];
    subtotal: number;
    discountTotal: number;
    deliveryFee: number;
    serviceFee?: number;
    total: number;
    estimatedReadyAt: number | null;
    estimatedArrivalAt: number | null;
    createdAt: number;
    confirmedAt: number | null;
    preparingAt: number | null;
    readyAt: number | null;
    outForDeliveryAt: number | null;
    arrivedAt: number | null;
    completedAt: number | null;
    cancelledAt: number | null;
    cancelReason: string | null;
    paymentDeadlineAt: number | null;
    /** Changes whenever anything about the order changes (cheap polling). */
    version?: number;
    /** A cash order accepted moments ago can still be cancelled by the customer until this time. */
    cancelGraceUntil?: number | null;
    refundedTotal: number;
    refunds: RefundView[];
    /** The customer can still ask for a refund (finished order, paid, inside the window, none open). */
    canRequestRefund: boolean;
    /** Delivered and not rated yet (inside the review window). */
    canReview?: boolean;
    review?: { rating: number; comment: string | null; reply: string | null } | null;
  };
  restaurant: { nameAr: string; nameEn: string; phone: string | null; slug: string; timezone: string };
  instapay: { accountName: string | null; address: string | null; phone: string | null; link: string | null; instructions: string | null; instructionsEn?: string | null } | null;
}

export interface PublicMenuProduct {
  id: string;
  categoryId: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn?: string | null;
  imageUrl: string | null;
  basePrice: number;
  isAvailable: boolean;
  /** Average stars from customers (shown once there are a few ratings). */
  rating?: { avg: number; count: number } | null;
  /** Units left, only when the restaurant shows stock to customers. */
  stockLeft?: number | null;
  variants: { id: string; nameAr: string; nameEn: string; price: number; isAvailable: boolean; isDefault: boolean }[];
  addonGroupIds: string[];
}

export interface PublicMenu {
  restaurant: {
    id: string;
    slug: string;
    nameAr: string;
    nameEn: string;
    logoUrl: string | null;
    coverImageUrl: string | null;
    badgeText: string | null;
    badgeTextEn?: string | null;
    taglineAr: string | null;
    taglineEn?: string | null;
    brandColor: string;
    phone: string | null;
    minOrderAmount: number;
    requirePhone: boolean;
    rating?: { avg: number; count: number } | null;
  };
  /** Latest customer comments (with the restaurant's reply). */
  reviews?: { id: string; rating: number; comment: string | null; customerName: string; reply: string | null; createdAt: number }[];
  store: { status: EffectiveStatus; reason: StatusReason; etaMinutes: number };
  categories: { id: string; nameAr: string; nameEn: string }[];
  products: PublicMenuProduct[];
  addonGroups: { id: string; nameAr: string; nameEn?: string; minSelect: number; maxSelect: number; addons: { id: string; nameAr: string; nameEn?: string; price: number; isAvailable: boolean }[] }[];
  banners: { id: string; titleAr: string; titleEn?: string | null; subtitleAr: string | null; subtitleEn?: string | null; imageUrl: string | null; bgColor: string; textColor: string }[];
  paymentMethods: { method: PaymentMethod }[];
  deliveryPoints: { id: string; nameAr: string; nameEn: string; isDefault: boolean; deliveryFee: number; kind: Fulfillment }[];
}

export interface QuoteResponse {
  lines: {
    productId: string;
    variantId: string | null;
    nameAr: string;
    nameEn?: string;
    variantNameAr: string | null;
    variantNameEn?: string | null;
    addons: { nameAr: string; nameEn?: string; price: number }[];
    unitPrice: number;
    addonsPerUnit: number;
    quantity: number;
    lineTotal: number;
  }[];
  pricingMode?: PricingMode;
  platformFeeAmount?: number;
  platformFeeBps?: number;
  /** Fixed online service fee, shown as its own row. */
  serviceFee?: number;
  subtotal: number;
  discount: number;
  promotion: { name: string; code: string | null } | null;
  promoError: { code: string; message: string } | null;
  deliveryFee: number;
  total: number;
  minOrderAmount: number;
  minOrderShortfall: number;
  etaMinutes: number;
}

/** Quote payload returned to a customer. Platform accounting fields stay server-side. */
export type CustomerQuoteResponse = Omit<QuoteResponse, 'pricingMode' | 'platformFeeAmount' | 'platformFeeBps'>;
