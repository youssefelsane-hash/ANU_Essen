import { localizeMessage, text, type Locale } from '@/lib/i18n';

// Keep messages already on screen in the selected language, even when a request
// started in the other language or the customer switches while offline.
const CUSTOMER_MESSAGES: [string, string][] = [
  ['تعذر حساب الطلب. جرّب مرة تانية.', "We couldn't calculate your order. Please try again."],
  ['الاتصال مش مستقر. جرّب تحديث حساب الطلب.', 'The connection is unstable. Try refreshing your order total.'],
  ['تعذر تأكيد الطلب. حاول مرة تانية.', "We couldn't confirm your order. Please try again."],
  ['الاتصال انقطع. اضغط تأكيد مرة تانية؛ المحاولة محفوظة ومش هيتكرر الطلب.', "The connection dropped. Confirm again; your attempt is saved and the order won't be duplicated."],
  ['مش قادرين نقرأ الصورة — تقدر تكمّل من غيرها', "We couldn't read the image. You can continue without it."],
  ['حصلت مشكلة، حاول تاني', 'Something went wrong. Please try again.'],
  ['النت ضعيف — حاول تاني', 'The connection is unstable. Please try again.'],
  ['تعذّر إلغاء الطلب. جرّب تاني.', "We couldn't cancel the order. Please try again."],
  ['الرد موصلناش بسبب الاتصال. بنراجع حالة الطلب؛ ممكن الإلغاء يكون تم.', 'The connection dropped before a reply. Checking your order; it may already be cancelled.'],
  ['تعذّر إرسال الطلب. جرّب تاني.', "We couldn't send the request. Please try again."],
];

export function customerMessage(message: string, locale: Locale): string {
  const pair = CUSTOMER_MESSAGES.find(([ar, en]) => ar === message || en === message);
  return pair ? text(locale, ...pair) : localizeMessage(message, locale);
}
