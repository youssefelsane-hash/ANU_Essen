/** DTOs shared by the server and the browser apps. Dates travel as epoch milliseconds. */
import type { OrderAction, OrderStatus, PaymentMethod, PaymentStatus } from './domain/order-machine';
import type { LoadLevel } from './domain/queue';
import type { EffectiveStatus, StatusReason } from './domain/store-status';

export interface SnapshotItem {
  id: string;
  nameAr: string;
  nameEn: string;
  variantNameAr: string | null;
  quantity: number;
  unitPrice: number;
  addonsPerUnit: number;
  lineTotal: number;
  addons: { nameAr: string; price: number }[];
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
  items: SnapshotItem[];
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
    items: SnapshotItem[];
    subtotal: number;
    discountTotal: number;
    deliveryFee: number;
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
  };
  restaurant: { nameAr: string; nameEn: string; phone: string | null; slug: string; timezone: string };
  instapay: { accountName: string | null; address: string | null; phone: string | null; link: string | null; instructions: string | null } | null;
}

export interface PublicMenuProduct {
  id: string;
  categoryId: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  imageUrl: string | null;
  basePrice: number;
  isAvailable: boolean;
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
    phone: string | null;
    minOrderAmount: number;
    requirePhone: boolean;
  };
  store: { status: EffectiveStatus; reason: StatusReason; etaMinutes: number };
  categories: { id: string; nameAr: string; nameEn: string }[];
  products: PublicMenuProduct[];
  addonGroups: { id: string; nameAr: string; minSelect: number; maxSelect: number; addons: { id: string; nameAr: string; price: number; isAvailable: boolean }[] }[];
  banners: { id: string; titleAr: string; subtitleAr: string | null; imageUrl: string | null; bgColor: string; textColor: string }[];
  paymentMethods: { method: PaymentMethod }[];
  deliveryPoints: { id: string; nameAr: string; nameEn: string; isDefault: boolean; deliveryFee: number }[];
}

export interface QuoteResponse {
  lines: {
    productId: string;
    variantId: string | null;
    nameAr: string;
    variantNameAr: string | null;
    addons: { nameAr: string; price: number }[];
    unitPrice: number;
    addonsPerUnit: number;
    quantity: number;
    lineTotal: number;
  }[];
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
