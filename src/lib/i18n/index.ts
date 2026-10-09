import { ACTION_AR, STATUS_AR, STATUS_EN, PAYMENT_METHOD_AR, PAYMENT_STATUS_AR, STORE_STATUS_AR, LOAD_LEVEL_AR, LOAD_LEVEL_LABEL } from '../labels';
import type { OrderAction, PaymentMethod, PaymentStatus } from '../domain/order-machine';

export type Locale = 'ar' | 'en';
export type LanguageScope = 'staff' | 'customer';
export const LANGUAGE_COOKIES = { staff: 'staff_language', customer: 'customer_language' } as const;
export const isLocale = (value: unknown): value is Locale => value === 'ar' || value === 'en';
export const text = (locale: Locale, ar: string, en: string) => locale === 'ar' ? ar : en;
export const direction = (locale: Locale) => locale === 'ar' ? 'rtl' : 'ltr';
export const localizedName = (locale: Locale, ar: string | null | undefined, en?: string | null) =>
  (locale === 'en' ? en?.trim() || ar?.trim() : ar?.trim() || en?.trim()) || '';
export function languageScope(pathname: string): LanguageScope {
  return /^\/(?:admin|merchant|login)(?:\/|$)/.test(pathname) || pathname.startsWith('/api/merchant/') ? 'staff' : 'customer';
}

/** Explicit choice wins; staff start in Arabic; customers follow the browser's supported language. */
export function resolveLocale(scope: LanguageScope, preference?: string | null, acceptLanguage?: string | null): Locale {
  if (isLocale(preference)) return preference;
  if (scope === 'staff') return 'ar';
  const candidates = (acceptLanguage || '').split(',').map((part, index) => {
    const [tag, ...params] = part.trim().toLowerCase().split(';');
    const qParam = params.find((p) => p.trim().startsWith('q='));
    const q = qParam ? Number(qParam.trim().slice(2)) : 1;
    return { tag: tag.split('-')[0], q, index };
  }).filter(({ q }) => Number.isFinite(q) && q > 0 && q <= 1).sort((a, b) => b.q - a.q || a.index - b.index);
  return candidates.find(({ tag }) => isLocale(tag))?.tag as Locale || 'en';
}

const ACTION_EN: Record<OrderAction, string> = { ACCEPT: 'Accept order', SUBMIT_PAYMENT: 'I have paid', VERIFY_PAYMENT: 'Confirm payment', REJECT_PAYMENT: 'Reject payment', START_PREPARING: 'Start preparing', MARK_READY: 'Ready', OUT_FOR_DELIVERY: 'Take for delivery', MARK_ARRIVED: 'Arrived at pickup', COMPLETE: 'Handed over', CANCEL: 'Cancel order' };
const PAYMENT_METHOD_EN: Record<PaymentMethod, string> = { INSTAPAY: 'InstaPay', CASH: 'Cash' };
const PAYMENT_STATUS_EN: Record<PaymentStatus, string> = { UNPAID: 'Unpaid', PAYMENT_SUBMITTED: 'Payment sent — awaiting review', PAYMENT_VERIFIED: 'Paid ✓', PAYMENT_REJECTED: 'Payment rejected', CASH: 'Cash on pickup', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partly refunded' };
const STORE_STATUS_EN = { OPEN: 'Open', BUSY: 'Busy', PAUSED: 'Paused', CLOSED: 'Closed' };
export function labels(locale: Locale) {
  return { status: locale === 'ar' ? STATUS_AR : STATUS_EN, action: locale === 'ar' ? ACTION_AR : ACTION_EN, paymentMethod: locale === 'ar' ? PAYMENT_METHOD_AR : PAYMENT_METHOD_EN, paymentStatus: locale === 'ar' ? PAYMENT_STATUS_AR : PAYMENT_STATUS_EN, storeStatus: locale === 'ar' ? STORE_STATUS_AR : STORE_STATUS_EN, loadLevel: locale === 'ar' ? LOAD_LEVEL_AR : LOAD_LEVEL_LABEL };
}

const ROLES: Record<string, [string, string]> = { SUPER_ADMIN: ['مدير المنصة', 'Platform owner'], MERCHANT_OWNER: ['صاحب المطعم', 'Restaurant owner'], MERCHANT_MANAGER: ['مدير المطعم', 'Restaurant manager'], CASHIER: ['الكاشير', 'Cashier'], KITCHEN_STAFF: ['فريق المطبخ', 'Kitchen team'], DELIVERY_STAFF: ['مسؤول التوصيل', 'Delivery team'] };
export const roleLabel = (key: string, locale: Locale, fallback?: string) => ROLES[key] ? text(locale, ...ROLES[key]) : fallback || key;

const PERMISSION_AR: Record<string, string> = { 'platform.restaurants': 'إدارة المطاعم وإعداداتها', 'platform.queue': 'ضبط أوقات التحضير والضغط', 'platform.finance': 'المبيعات والعمولات والتسويات', 'platform.users': 'الحسابات والصلاحيات', 'platform.audit': 'سجل التغييرات', 'platform.settings': 'إعدادات المنصة', 'orders.view': 'عرض الطلبات', 'orders.accept': 'قبول طلبات الكاش', 'orders.create': 'تسجيل طلبات من الكاشير', 'orders.kitchen': 'تحضير الطلب وتجهيزه', 'orders.delivery': 'توصيل الطلب وتسليمه', 'orders.cancel': 'إلغاء الطلبات', 'payments.verify': 'مراجعة التحويل وتأكيد الدفع', 'payments.refund': 'استرداد المبالغ وطلبات الاسترجاع', 'receipts.print': 'طباعة الفواتير', 'menu.availability': 'إظهار الأصناف المتاحة', 'menu.manage': 'تعديل المنيو والأسعار والعروض', 'store.status': 'فتح استقبال الطلبات أو إيقافه', 'store.profile': 'تعديل اسم وشكل المطعم', 'couriers.cash': 'استلام وتصحيح عهدة كاش المندوبين', 'staff.manage': 'إدارة فريق المطعم', 'reports.view': 'عرض المبيعات وسجل الطلبات', 'audit.view': 'عرض سجل تغييرات المطعم' };
PERMISSION_AR['couriers.cash'] = 'مراجعة واستلام عهدة المندوبين';
PERMISSION_AR['platform.support'] = 'الشكاوى والتقييمات وحظر العملاء (كل المطاعم)';
PERMISSION_AR['support.manage'] = 'الرد على شكاوى وتقييمات المطعم';
export const permissionLabel = (key: string, locale: Locale, fallback?: string) => locale === 'ar' ? PERMISSION_AR[key] || fallback || key : fallback || key;

// Only UI/system messages belong here. Names, notes and merchant-entered reasons stay intact.
const MESSAGES: [string, string][] = [
  ['خلّص توصيلات المندوب الجارية قبل إزالة المطعم من حسابه.', 'Finish the courier’s active deliveries before removing a restaurant'],
  ['اختار مطعمًا واحدًا على الأقل.', 'Select at least one restaurant'], ['اختار مطعمًا موجودًا.', 'Unknown restaurant'],
  ['المبلغ أكبر من النقدية المتبقية مع المندوب', 'The amount exceeds the courier’s outstanding cash balance'],
  ['يمكن تصحيح قيد استلام أصلي فقط.', 'Only an original hand-in can be reversed'], ['تم تصحيح هذا القيد بالفعل.', 'This hand-in was already reversed'],
  ['تم حفظ اسم وشكل المطعم.', 'Restaurant appearance saved.'], ['راجع رابط الصورة وحاول تاني.', 'Check the image link and try again.'], ['استخدم صورة من جهازك أو رابط صورة مباشر.', 'Upload a photo or use a direct image link.'], ['استخدم صورة مرفوعة للمطعم ده.', 'Use a photo uploaded for this restaurant.'],
  ['تم تجاهل إجراء لأن الطلب اتغيّر من جهاز تاني — الشاشة اتحدثت بحالة السيرفر.', 'This order changed on another device. The board now shows the latest saved status.'],
  ['لا يوجد وصول لطلبات المطعم ده', 'No access to this restaurant orders'], ['الصورة غير موجودة', 'No screenshot'], ['المحل مغلق حاليًا', 'The restaurant is currently closed'], ['الصورة كبيرة', 'The image is too large'], ['الملف ليس صورة صالحة', 'This file is not a valid image'], ['الخدمة موقوفة من إدارة المنصة — مينفعش تفتحوا الطلبات دلوقتي', 'The platform has suspended service. Ordering cannot be reopened.'], ['تأكيد الطلب غير صالح. حدّث الصفحة وحاول تاني.', 'Missing or invalid Idempotency-Key header'], ['انتظر مزامنة الإجراء السابق لنفس الطلب', 'Earlier action for this order must sync first'], ['ألغاه العميل', 'Cancelled by the customer'], ['انتهت مهلة الدفع', 'The payment deadline expired'],
  ['الطلب ده مفيهوش مبلغ مدفوع يترجع', 'This order has no received payment left to refund'], ['مبلغ الاسترداد لازم يكون أكبر من صفر ومش أكتر من المتبقي', 'The refund amount must be above zero and not more than what remains'],
  ['اكتب سبب الرفض عشان العميل يعرفه', 'Write the reason so the customer knows'], ['الطلب ده اتراجع بالفعل', 'This request was already handled'], ['اكتب سبب طلب الاسترجاع', 'Write why you want a refund'],
  ['الطلب ده مش متاح لطلب استرجاع', 'This order cannot be refunded from here — contact the restaurant'], ['طلب الاسترجاع موجود بالفعل وبيتراجع', 'Your refund request is already being reviewed'],
  ['تم تسجيل الاسترداد', 'Refund recorded'], ['تم رفض طلب الاسترجاع', 'Refund request declined'],
  ['اسم رابط المنيو كلمة قصيرة بالإنجليزي زي al-raya، مش رابط صورة أو موقع', 'The menu link name is a short English word like al-raya, not an image or web address'],
  ['راجع مبالغ رسوم المنصة والتوصيل (من 0 لـ 500 ج.م)', 'Check the platform fee and delivery amounts (0–500 EGP)'],
  ['تم تحديث الكمية', 'Stock updated'],
  ['المطعم بدأ في طلبك، مينفعش يتلغي من هنا. كلّم المطعم.', 'The restaurant has started your order, so it can’t be cancelled here. Please call the restaurant.'],
  ['الرقم ده موقوف من الطلب أونلاين. تواصل مع الدعم.', 'This number can’t place online orders. Please contact support.'],
  ['الدفع كاش مش متاح للرقم ده بسبب طلبات قبل كده ما اتستلمتش. ادفع بإنستاباي.', 'Cash isn’t available for this number because earlier orders weren’t collected. Please pay by InstaPay.'],
  ['عندك طلبات لسه مفتوحة على الرقم ده. استنى لما تستلمها وبعدين اطلب تاني.', 'You still have open orders on this number. Collect them first, then order again.'],
  ['تم تسجيل إن العميل ما استلمش', 'Recorded as not collected'], ['الخيار ده للطلبات الجاهزة اللي ما اتستلمتش بس', 'Only for ready orders that were not collected'],
  ['تم إرسال الرد', 'Reply sent'], ['اكتب ردك', 'Write your reply'], ['اكتب المشكلة بالتفصيل شوية', 'Please describe the problem in a bit more detail'],
  ['اكتب رقم موبايلك عشان نقدر نرد عليك', 'Enter your mobile number so we can reply'], ['التقييم متاح بعد استلام الطلب ولمدة أسبوع', 'You can rate an order for a week after receiving it'], ['الطلب ده اتقيّم قبل كده', 'This order was already rated'],
  ['مينفعش تدّي صلاحيات انت نفسك مش عندك', 'You cannot grant permissions you do not have yourself'], ['الحساب ده عنده صلاحيات أعلى منك؛ صاحب المنصة بس اللي يعدّله', 'This account has more permissions than you; only the platform owner can change it'],
  ['الكود ده خاص برقم الموبايل اللي كسبه', 'This code only works with the mobile number that won it'],
  ['قيمة الخصم لازم تكون من 1 لـ 500 ج.م', 'The prize must be between 1 and 500 EGP'], ['راجع أقل قيمة للطلب', 'Check the minimum order'],
  ['تم الحفظ', 'Saved'], ['لا يوجد تغيير', 'Nothing changed'], ['حصل خطأ غير متوقع، حاول تاني', 'Unexpected error — please try again'],
  ['بيانات غير صحيحة', 'Please check the information and try again'], ['اكتب اسمك', 'Enter your name'], ['السلة فاضية', 'Your basket is empty'],
  ['اكتب البريد الإلكتروني وكلمة المرور', 'Enter your email and password'], ['محاولات كتير. جرّب تاني بعد 15 دقيقة', 'Too many attempts. Try again in 15 minutes'], ['البريد الإلكتروني أو كلمة المرور غير صحيحة', 'Incorrect email or password'], ['الحساب ده موقوف. كلّم صاحب المطعم أو إدارة المنصة.', 'This account is blocked. Contact the restaurant owner or platform administrator.'],
  ['المحل غير موجود', 'Restaurant not found'], ['الطلب غير موجود', 'Order not found'], ['الصنف غير موجود', 'Product not found'],
  ['سجّل الدخول أولًا', 'Please sign in'], ['ليس لديك صلاحية لهذا الإجراء', 'You do not have permission for this action'], ['ليس لديك صلاحية لهذا الإجراء', 'Not allowed to perform this action'], ['لا يمكنك إعادة هذا الإجراء', 'Not allowed to replay this action'],
  ['مكان الاستلام غير متاح', 'Pickup location is unavailable'], ['رقم الموبايل غير صحيح', 'Enter a valid Egyptian mobile number'], ['رقم الموبايل مطلوب', 'A mobile number is required'], ['طريقة الدفع دي مش متاحة حاليًا', 'This payment method is currently unavailable'],
  ['تم استخدام نفس مفتاح الطلب لبيانات مختلفة', 'This request was already used for a different order. Please start again.'], ['مفتاح الإجراء مستخدم لطلب أو بيانات مختلفة', 'This action was already used with different information. Refresh and try again.'],
  ['انتهت مهلة الدفع، ابدأ طلبًا جديدًا', 'The payment time has expired. Start a new order.'], ['الطلب أونلاين من المطعم ده متوقف مؤقتًا', 'Online ordering is temporarily unavailable at this restaurant'],
  ['طلبات كتير في وقت قصير، استنى شوية وحاول تاني', 'Too many requests. Wait a moment and try again'],
  ['الكود غير صحيح', 'This code is invalid'], ['الكود لم يبدأ بعد', 'This offer has not started yet'], ['الكود منتهي', 'This code has expired'], ['الكود استُخدم بالكامل', 'This code has reached its usage limit'], ['الكود لا ينطبق على طلبك', 'This offer does not apply to your order'],
  ['قيمة طلبك أقل من الحد الأدنى للعرض. ضيف أصناف وجرب الكود تاني.', 'Your basket is below the offer minimum. Add items and try the code again.'],
  ['الكمية غير صحيحة', 'Invalid quantity'], ['منتج في السلة لم يعد موجودًا في المنيو', 'An item in your basket is no longer on the menu'],
  ['المطعم مقفول حاليًا', 'The restaurant is currently closed'], ['الطلبات متوقفة مؤقتًا بسبب ضغط الطلبات', 'Ordering is paused while the kitchen catches up'], ['الطلبات متوقفة مؤقتًا', 'Ordering is temporarily paused'], ['المطعم خارج مواعيد العمل', 'The restaurant is outside its opening hours'],
  ['الطلب ده مع مسؤول توصيل تاني', 'This delivery is assigned to someone else'], ['حالة الطلب اتغيّرت. حدّث الشاشة وحاول تاني.', 'The order has changed. Refresh and try again.'],
  ['حجم الطلب كبير جدًا', 'Request too large'], ['بيانات غير صحيحة', 'Invalid JSON'], ['تم رفض الطلب من مصدر غير مسموح', 'Cross-origin request blocked'], ['تم رفض الطلب من مصدر غير مسموح', 'Bad origin'],
  ['تم تسجيل التسوية', 'Settlement recorded'], ['اكتب المبلغ المستلم', 'Enter the amount received'], ['الفترة غير صحيحة', 'Invalid period'], ['اختر وظيفة صحيحة', 'Unknown role'], ['الحساب ده موجود بالبريد ده بالفعل', 'A user with this email already exists'], ['تم إنشاء الحساب', 'User created'], ['تم تحديد الوظيفة', 'Role assigned'], ['تم حفظ الوظيفة', 'Role saved'], ['تم حفظ الإعدادات', 'Settings saved'], ['العمولة لازم تكون من 0 إلى 50%', 'Commission must be 0–50%'], ['اختر منطقة زمنية صحيحة', 'Unknown timezone'], ['لا يمكنك إيقاف حسابك', 'You cannot disable yourself'], ['لا يمكنك حظر حسابك', 'You cannot block yourself'], ['لا يمكنك إزالة صلاحيتك كمدير المنصة', 'You cannot remove your own super admin role'], ['لا يمكنك إزالة وظيفتك', 'You cannot remove your own role'], ['مدير المنصة لديه كل الصلاحيات دائمًا', 'SUPER_ADMIN always has every permission'],
  ['تم تغيير كلمة المرور وتسجيل خروج كل الأجهزة', 'Password changed (all sessions signed out)'], ['تم حفظ نقطة الاستلام', 'Delivery point saved'], ['تم حفظ وقت التحضير للطلبات الجديدة', 'Queue configuration saved — applies to orders confirmed from now on'], ['تم حفظ القسم', 'Category saved'], ['اختر القسم', 'Choose a category'], ['تم حفظ الصنف', 'Product saved'], ['مجموعة إضافات غير صحيحة', 'Invalid addon group'], ['الحد الأدنى لا يمكن أن يتجاوز الحد الأقصى', 'min cannot exceed max'], ['تم حفظ الإضافات', 'Addon group saved'], ['تم حفظ الإعلان', 'Banner saved'], ['تم حفظ العرض', 'Promotion saved'], ['القيمة غير صحيحة', 'Invalid value'], ['النسبة لا تتجاوز 100%', 'Percent must be ≤ 100'], ['اختر الصنف', 'Choose the product'], ['الصنف لا يتبع المطعم ده', 'Product does not belong to this restaurant'], ['أضف عنوان إنستاباي أو رقم الهاتف قبل تفعيل الدفع', 'InstaPay needs an address or phone before it can be enabled'], ['اكتب رابط المطعم بالحروف الإنجليزية والأرقام', 'Slug is required (latin letters/numbers)'], ['اكتب رابط المطعم', 'Slug is required'], ['تم إيقاف الخدمة والطلبات الجديدة', 'Service suspended — new orders are blocked'],
  ['سعر غير صحيح', 'Invalid price'], ['سعر غير صحيح', 'سعر غير صحيح'], ['تم تحديث السعر', 'Price updated'], ['تمت الإضافة', 'Added'], ['تم تغيير كلمة السر', 'Password changed'], ['اختر وظيفة في المطعم', 'Choose a store role'], ['مدير المنصة هو اللي يقدر يضيف أصحاب المطاعم', 'Only the platform owner can add owners'], ['الموظف ده بيشتغل في مطعم تاني أيضًا. تواصل مع مدير المنصة.', 'This user also works elsewhere — ask the platform admin'], ['الموظف ده بيشتغل في مطعم تاني. احذف وظيفته هنا أو تواصل مع مدير المنصة.', 'This user also works elsewhere — remove their role here, or ask the platform admin'],
];
export function localizeMessage(message: string, locale: Locale): string {
  const pair = MESSAGES.find(([ar, en]) => ar === message || en === message);
  if (pair) return text(locale, ...pair);
  const password = message.match(/^(?:Password must be at least |كلمة السر لازم )(\d+)(?: characters| حروف على الأقل)$/);
  if (password) return text(locale, `كلمة المرور لا تقل عن ${password[1]} حروف`, `Password must be at least ${password[1]} characters`);
  const minimum = message.match(/^(?:الحد الأدنى للطلب |الكود للطلبات من )(.*) ج\.م$/);
  if (minimum) return text(locale, message, `${message.startsWith('الكود') ? 'This offer requires' : 'Minimum order'} ${minimum[1]} EGP`);
  if (/^Cannot \w+ an order that is /.test(message) || message === 'Order changed since the background job inspected it') return text(locale, 'حالة الطلب اتغيّرت. حدّث الشاشة وحاول تاني.', 'The order has changed. Refresh and try again.');
  if (/غير متاح(?:ة)? حاليًا/.test(message)) return text(locale, message, 'One of your selected items is currently unavailable. Please update your basket.');
  if (/^(اختر الحجم لـ |الحجم المختار غير موجود لـ |إضافة غير صحيحة لـ |اختر .* لـ |أقصى عدد من )/.test(message)) return text(locale, message, 'Please review the size and extras selected for this item.');
  if (/^Slug ".+" is already used$/.test(message)) return text(locale, 'الرابط مستخدم لمطعم آخر. اختار رابط مختلف.', message);
  if (/^Code .+ already exists$/.test(message)) return text(locale, 'كود الخصم موجود بالفعل. اختار كود مختلف.', message);
  if (/: invalid (amount|date|price)$/.test(message) || /^Invalid \w+$/.test(message)) return text(locale, 'راجع البيانات والأسعار والتواريخ المدخلة.', 'Please check the information, prices and dates.');
  return message;
}

export function errorMessage(code: string, locale: Locale, original?: string): string {
  if (original) {
    const translated = localizeMessage(original, locale);
    if (translated !== original || (locale === 'ar' ? /[\u0600-\u06ff]/.test(original) : !/[\u0600-\u06ff]/.test(original)) && original !== code) return translated;
  }
  const messages: Record<string, [string, string]> = {
    VALIDATION: ['راجع البيانات وحاول تاني.', 'Check the information and try again.'], UNAUTHENTICATED: ['سجّل الدخول أولًا.', 'Please sign in first.'], FORBIDDEN: ['ليس لديك صلاحية لهذا الإجراء.', 'You do not have permission for this action.'], NOT_FOUND: ['العنصر ده غير موجود.', 'This item was not found.'], CONFLICT: ['البيانات اتغيّرت. حدّث الصفحة وحاول تاني.', 'The information has changed. Refresh and try again.'], INTERNAL: ['حصل خطأ غير متوقع، حاول تاني.', 'Something went wrong. Please try again.'], PRICING: ['راجع الأصناف والأسعار في السلة.', 'Please review the items and prices in your basket.'], STORE_CLOSED: ['المطعم مقفول حاليًا.', 'The restaurant is currently closed.'], STORE_PAUSED: ['استقبال الطلبات متوقف مؤقتًا.', 'Ordering is temporarily paused.'], PAYLOAD_TOO_LARGE: ['حجم الملف أو الطلب كبير جدًا.', 'The file or request is too large.'] };
  return text(locale, ...(messages[code] || messages.INTERNAL));
}
