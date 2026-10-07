import { formatDateTime, formatMoney } from './domain/misc';
import { PAYMENT_METHOD_AR } from './labels';
import type { OrderSnapshot } from './types';

/**
 * Plain-text receipt (fixed width) for raw/ESC-POS printing integrations (QZ Tray, PrintNode,
 * a local print bridge). 80mm paper ≈ 42 columns, 58mm ≈ 32 columns.
 */
export function receiptText(order: OrderSnapshot, restaurantName: string, timeZone: string, columns = 42): string {
  const line = '-'.repeat(columns);
  const row = (left: string, right: string) => {
    const space = Math.max(1, columns - left.length - right.length);
    return left + ' '.repeat(space) + right;
  };
  const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((columns - s.length) / 2))) + s;
  const out = [
    center(restaurantName),
    center(`Order #${order.orderNumber}`),
    center(formatDateTime(order.createdAt, timeZone)),
    line,
    `Customer: ${order.customerName}`,
    ...(order.customerPhone ? [`Phone: ${order.customerPhone}`] : []),
    line,
  ];
  for (const it of order.items) {
    out.push(row(`${it.quantity} x ${it.nameAr}${it.variantNameAr ? ` (${it.variantNameAr})` : ''}`, formatMoney(it.lineTotal, 'en')));
    for (const a of it.addons) out.push(`   + ${a.nameAr}`);
    if (it.note) out.push(`   * ${it.note}`);
  }
  out.push(line, row('Subtotal', formatMoney(order.subtotal, 'en')));
  if (order.discountTotal) out.push(row('Discount', `-${formatMoney(order.discountTotal, 'en')}`));
  if (order.deliveryFee) out.push(row('Delivery', formatMoney(order.deliveryFee, 'en')));
  out.push(row('TOTAL', formatMoney(order.total, 'en')), line);
  const paid = order.paymentStatus === 'PAYMENT_VERIFIED' ? 'PAID' : order.paymentMethod === 'CASH' ? 'COLLECT CASH' : order.paymentStatus;
  out.push(`Payment: ${PAYMENT_METHOD_AR[order.paymentMethod]} ${paid}`, `Delivery: ${order.deliveryPointName}`);
  if (order.customerNote) out.push(`Note: ${order.customerNote}`);
  return out.join('\n');
}
