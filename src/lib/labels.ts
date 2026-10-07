import type { OrderAction, OrderStatus, PaymentMethod, PaymentStatus } from './domain/order-machine';

export const STATUS_AR: Record<OrderStatus, string> = {
  CREATED: 'بانتظار قبول المحل',
  AWAITING_PAYMENT: 'بانتظار التحويل',
  PAYMENT_REVIEW: 'مراجعة التحويل',
  CONFIRMED: 'مؤكد',
  PREPARING: 'بيتحضر',
  READY: 'جاهز',
  OUT_FOR_DELIVERY: 'في الطريق',
  ARRIVED_AT_GATE: 'عند البوابة',
  COMPLETED: 'تم التسليم',
  CANCELLED: 'ملغي',
};

export const STATUS_EN: Record<OrderStatus, string> = {
  CREATED: 'Created',
  AWAITING_PAYMENT: 'Awaiting payment',
  PAYMENT_REVIEW: 'Payment review',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  ARRIVED_AT_GATE: 'Arrived at gate',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONE: Record<OrderStatus, string> = {
  CREATED: 'bg-amber-100 text-amber-800',
  AWAITING_PAYMENT: 'bg-gray-100 text-gray-700',
  PAYMENT_REVIEW: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PREPARING: 'bg-orange-100 text-orange-800',
  READY: 'bg-green-100 text-green-800',
  OUT_FOR_DELIVERY: 'bg-purple-100 text-purple-800',
  ARRIVED_AT_GATE: 'bg-purple-100 text-purple-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-red-100 text-red-700',
};

export const ACTION_AR: Record<OrderAction, string> = {
  ACCEPT: 'قبول الطلب',
  SUBMIT_PAYMENT: 'تم التحويل',
  VERIFY_PAYMENT: 'تأكيد الدفع',
  REJECT_PAYMENT: 'رفض التحويل',
  START_PREPARING: 'ابدأ التحضير',
  MARK_READY: 'جاهز',
  OUT_FOR_DELIVERY: 'خرج للتوصيل',
  MARK_ARRIVED: 'وصل البوابة',
  COMPLETE: 'تم التسليم',
  CANCEL: 'إلغاء الطلب',
};

export const PAYMENT_METHOD_AR: Record<PaymentMethod, string> = { INSTAPAY: 'InstaPay', CASH: 'كاش' };

export const PAYMENT_STATUS_AR: Record<PaymentStatus, string> = {
  UNPAID: 'لم يُدفع',
  PAYMENT_SUBMITTED: 'تم التحويل — بانتظار المراجعة',
  PAYMENT_VERIFIED: 'مدفوع ✓',
  PAYMENT_REJECTED: 'التحويل مرفوض',
  CASH: 'كاش عند الاستلام',
  REFUNDED: 'مسترد',
  PARTIALLY_REFUNDED: 'مسترد جزئيًا',
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, string> = {
  UNPAID: 'bg-gray-100 text-gray-700',
  PAYMENT_SUBMITTED: 'bg-amber-100 text-amber-800',
  PAYMENT_VERIFIED: 'bg-green-100 text-green-800',
  PAYMENT_REJECTED: 'bg-red-100 text-red-700',
  CASH: 'bg-sky-100 text-sky-800',
  REFUNDED: 'bg-gray-100 text-gray-700',
  PARTIALLY_REFUNDED: 'bg-amber-100 text-amber-800',
};

export const STORE_STATUS_AR = { OPEN: 'مفتوح', BUSY: 'زحمة شوية', PAUSED: 'متوقف مؤقتًا', CLOSED: 'مغلق' } as const;
export const LOAD_LEVEL_LABEL = { NORMAL: 'Normal', BUSY: 'Busy', HEAVY: 'Heavy rush', FULL: 'Full' } as const;
export const LOAD_LEVEL_AR = { NORMAL: 'عادي', BUSY: 'زحمة', HEAVY: 'ضغط شديد', FULL: 'ممتلئ' } as const;
