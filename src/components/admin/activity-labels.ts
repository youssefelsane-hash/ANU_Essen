import { labels, text, type Locale } from '@/lib/i18n';
import type { OrderAction } from '@/lib/domain/order-machine';

const ACTIVITIES: Record<string, [string, string]> = {
  'auth.login': ['تسجيل الدخول', 'Signed in'], 'auth.login_failed': ['دخول غير ناجح', 'Failed sign-in'], 'auth.login_blocked': ['دخول لحساب محظور', 'Blocked sign-in'],
  'restaurant.created': ['إضافة مطعم', 'Restaurant created'], 'restaurant.updated': ['تعديل مطعم', 'Restaurant updated'], 'restaurant.suspended': ['إيقاف الخدمة', 'Service suspended'], 'restaurant.resumed': ['تشغيل الخدمة', 'Service resumed'], 'restaurant.commission_changed': ['تغيير العمولة', 'Commission changed'],
  'menu.category_created': ['إضافة قسم', 'Category created'], 'menu.category_updated': ['تعديل قسم', 'Category updated'], 'menu.product_created': ['إضافة منتج', 'Product created'], 'menu.product_updated': ['تعديل منتج', 'Product updated'], 'menu.product_restored': ['إظهار منتج', 'Product restored'], 'menu.product_archived': ['إخفاء منتج', 'Product archived'], 'menu.price_changed': ['تغيير سعر', 'Price changed'], 'menu.product_availability': ['تغيير توفر منتج', 'Product availability changed'], 'menu.variant_availability': ['تغيير توفر حجم', 'Size availability changed'], 'menu.addon_availability': ['تغيير توفر إضافة', 'Extra availability changed'], 'menu.addon_group_created': ['إضافة مجموعة إضافات', 'Extra group created'], 'menu.addon_group_updated': ['تعديل إضافات', 'Extras updated'],
  'payment_method.updated': ['تعديل طريقة الدفع', 'Payment method updated'], 'queue.config_changed': ['تعديل أوقات التحضير', 'Preparation times updated'], 'settlement.recorded': ['تسجيل عمولة مستلمة', 'Commission received'], 'settings.updated': ['تعديل الإعدادات', 'Settings updated'],
  'user.created': ['إضافة مستخدم', 'User created'], 'user.enabled': ['إلغاء حظر مستخدم', 'User enabled'], 'user.disabled': ['حظر مستخدم', 'User blocked'], 'user.password_reset': ['تغيير كلمة مرور', 'Password changed'], 'user.role_assigned': ['إضافة دور لمستخدم', 'User role assigned'], 'user.role_removed': ['حذف دور من مستخدم', 'User role removed'],
  'staff.role_assigned': ['إضافة دور لموظف', 'Staff role assigned'], 'staff.role_removed': ['حذف دور من موظف', 'Staff role removed'], 'staff.password_reset': ['تغيير كلمة مرور موظف', 'Staff password changed'], 'staff.blocked': ['حظر موظف', 'Staff blocked'], 'staff.unblocked': ['إلغاء حظر موظف', 'Staff unblocked'],
  'role.created': ['إضافة دور', 'Role created'], 'role.permissions_changed': ['تعديل صلاحيات', 'Permissions updated'], 'delivery_point.created': ['إضافة مكان استلام', 'Pickup point created'], 'delivery_point.updated': ['تعديل مكان استلام', 'Pickup point updated'],
  'banner.created': ['إضافة إعلان', 'Banner created'], 'banner.updated': ['تعديل إعلان', 'Banner updated'], 'banner.deleted': ['حذف إعلان', 'Banner deleted'], 'promotion.created': ['إضافة خصم', 'Offer created'], 'promotion.updated': ['تعديل خصم', 'Offer updated'],
};
const ENTITIES: Record<string, [string, string]> = { user: ['مستخدم', 'User'], order: ['طلب', 'Order'], restaurant: ['مطعم', 'Restaurant'], role: ['دور', 'Role'], product: ['منتج', 'Product'], category: ['قسم', 'Category'], addon: ['إضافة', 'Extra'], addon_group: ['مجموعة إضافات', 'Extra group'], variant: ['حجم', 'Size'], delivery_point: ['مكان استلام', 'Pickup point'], payment_method: ['طريقة دفع', 'Payment method'], queue_config: ['وقت التحضير', 'Preparation time'], settlement: ['تحصيل عمولة', 'Commission receipt'], system_settings: ['إعدادات المنصة', 'System settings'], banner: ['إعلان', 'Banner'], promotion: ['خصم', 'Offer'] };
export function activityLabel(action: string, locale: Locale) {
  if (ACTIVITIES[action]) return text(locale, ...ACTIVITIES[action]);
  const orderAction = action.startsWith('order.') ? action.slice(6).toUpperCase() as OrderAction : null;
  if (orderAction && labels(locale).action[orderAction]) return labels(locale).action[orderAction];
  return text(locale, 'تغيير مسجل', 'Recorded change');
}
export const entityLabel = (entity: string, locale: Locale) => ENTITIES[entity] ? text(locale, ...ENTITIES[entity]) : text(locale, 'عنصر', 'Item');
export const actorTypeLabel = (type: string, locale: Locale) => type === 'USER' ? text(locale, 'فريق العمل', 'Team member') : type === 'CUSTOMER' ? text(locale, 'عميل', 'Customer') : text(locale, 'النظام', 'System');

/** Match the human labels used on the page while preserving searches for stored action codes. */
export function matchingActivityCodes(query: string): string[] {
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[\u064b-\u065f]/g, '').replace(/[أإآ]/g, 'ا');
  const needle = normalize(query);
  if (!needle) return [];
  const codes = [...Object.keys(ACTIVITIES), ...Object.keys(labels('en').action).map((action) => `order.${action.toLowerCase()}`)];
  return codes.filter((code) => normalize(activityLabel(code, 'ar')).includes(needle) || normalize(activityLabel(code, 'en')).includes(needle));
}
