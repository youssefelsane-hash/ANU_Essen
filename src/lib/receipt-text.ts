import { formatDateTime, formatMoney } from './domain/misc';
import { labels, localizedName, text, type Locale } from './i18n';
import type { OrderSnapshot } from './types';

/**
 * Plain-text receipt (fixed width) for raw/ESC-POS printing integrations (QZ Tray, PrintNode,
 * a local print bridge). 80mm paper ≈ 42 columns, 58mm ≈ 32 columns.
 */
export function receiptText(order: OrderSnapshot, restaurantName: string, timeZone: string, columns = 42, locale: Locale = 'en'): string {
  const t = (ar: string, en: string) => text(locale, ar, en);
  const copy = labels(locale);
  const line = '-'.repeat(columns);
  const row = (left: string, right: string) => {
    const space = Math.max(1, columns - left.length - right.length);
    return left + ' '.repeat(space) + right;
  };
  const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((columns - s.length) / 2))) + s;
  const out = [
    center(restaurantName),
    center(`${t('طلب', 'Order')} #${order.orderNumber}`),
    center(formatDateTime(order.createdAt, timeZone, locale)),
    line,
    `${t('العميل', 'Customer')}: ${order.customerName}`,
    ...(order.customerPhone ? [`${t('الهاتف', 'Phone')}: ${order.customerPhone}`] : []),
    line,
  ];
  for (const it of order.items) {
    out.push(row(`${it.quantity} x ${localizedName(locale, it.nameAr, it.nameEn)}${it.variantNameAr ? ` (${localizedName(locale, it.variantNameAr, it.variantNameEn)})` : ''}`, formatMoney(it.lineTotal, locale)));
    for (const a of it.addons) out.push(`   + ${localizedName(locale, a.nameAr, a.nameEn)}`);
    if (it.note) out.push(`   * ${it.note}`);
  }
  out.push(line, row(t('المجموع', 'Subtotal'), formatMoney(order.subtotal, locale)));
  if (order.discountTotal) out.push(row(t('الخصم', 'Discount'), `-${formatMoney(order.discountTotal, locale)}`));
  if (order.deliveryFee) out.push(row(t('التوصيل', 'Delivery'), formatMoney(order.deliveryFee, locale)));
  out.push(row(t('الإجمالي', 'TOTAL'), formatMoney(order.total, locale)), line);
  const paid = order.paymentStatus === 'PAYMENT_VERIFIED' ? t('مدفوع', 'PAID') : order.paymentMethod === 'CASH' ? t('تحصيل كاش', 'COLLECT CASH') : copy.paymentStatus[order.paymentStatus];
  out.push(`${t('الدفع', 'Payment')}: ${copy.paymentMethod[order.paymentMethod]} ${paid}`, `${t('الاستلام', 'Pickup point')}: ${localizedName(locale, order.deliveryPointName, order.deliveryPointNameEn)}`);
  if (order.customerNote) out.push(`${t('ملاحظة', 'Note')}: ${order.customerNote}`);
  return out.join('\n');
}
