/** Plain-language help for every permission, grouped for the roles screen. */
export type PermissionGroup = 'platform' | 'orders' | 'money' | 'menu' | 'team';

export const PERMISSION_GROUPS: { key: PermissionGroup; ar: string; en: string }[] = [
  { key: 'platform', ar: 'إدارة المنصة', en: 'Platform management' },
  { key: 'orders', ar: 'الطلبات والتوصيل', en: 'Orders & delivery' },
  { key: 'money', ar: 'الدفع والفلوس', en: 'Payments & money' },
  { key: 'menu', ar: 'المنيو والمطعم', en: 'Menu & restaurant' },
  { key: 'team', ar: 'الفريق والتقارير والدعم', en: 'Team, reports & support' },
];

export const PERMISSION_HELP: Record<string, { group: PermissionGroup; ar: string; en: string; sensitive?: boolean }> = {
  'platform.restaurants': { group: 'platform', ar: 'يضيف مطاعم ويعدّل إعداداتها ومنيوهاتها وطلباتها، ويوقف مطعم', en: 'Add restaurants, edit their settings, menus and orders, suspend a restaurant' },
  'platform.queue': { group: 'platform', ar: 'يغيّر أوقات التحضير وحدود ضغط المطبخ', en: 'Change preparation times and kitchen limits' },
  'platform.finance': { group: 'platform', ar: 'يشوف المبيعات وحصة المنصة ويسجّل التحصيل من المطاعم', en: 'See sales and platform earnings, record settlements' },
  'platform.users': { group: 'platform', ar: 'يضيف حسابات ويحدد صلاحياتها (حساسة جدًا)', en: 'Create accounts and set their permissions (very sensitive)', sensitive: true },
  'platform.audit': { group: 'platform', ar: 'يشوف سجل كل التغييرات (مين عمل إيه)', en: 'See the full change log (who did what)' },
  'platform.settings': { group: 'platform', ar: 'يغيّر إعدادات المنصة العامة والهوية والحماية (حساسة)', en: 'Change platform settings, identity and protection (sensitive)', sensitive: true },
  'platform.support': { group: 'platform', ar: 'يرد على كل الشكاوى، يخفي التقييمات المسيئة، ويوقف أرقام العملاء', en: 'Answer all complaints, hide abusive reviews, block customer numbers' },
  'orders.view': { group: 'orders', ar: 'يشوف كل الطلبات', en: 'See all orders' },
  'orders.accept': { group: 'orders', ar: 'يقبل الطلبات', en: 'Accept orders' },
  'orders.create': { group: 'orders', ar: 'يسجّل طلب من الكاشير لعميل واقف قدامه', en: 'Enter walk-in orders at the counter' },
  'orders.kitchen': { group: 'orders', ar: 'يبدأ التحضير ويعلّم الطلب جاهز', en: 'Start preparing and mark ready' },
  'orders.delivery': { group: 'orders', ar: 'يستلم الطلب ويوصّله ويسلّمه', en: 'Pick up, deliver and hand over orders' },
  'orders.cancel': { group: 'orders', ar: 'يلغي الطلبات ويسجّل «العميل ما استلمش»', en: 'Cancel orders and record no-shows' },
  'payments.verify': { group: 'money', ar: 'يراجع تحويلات إنستاباي ويأكدها أو يرفضها', en: 'Check and confirm or reject InstaPay transfers' },
  'payments.refund': { group: 'money', ar: 'يرجّع فلوس للعميل ويرد على طلبات الاسترجاع', en: 'Refund customers and handle refund requests' },
  'couriers.cash': { group: 'money', ar: 'يستلم الكاش من المندوبين ويصحّح العهدة', en: 'Receive and correct courier cash hand-ins' },
  'receipts.print': { group: 'orders', ar: 'يطبع الفواتير', en: 'Print receipts' },
  'menu.availability': { group: 'menu', ar: 'يقفل/يفتح الأصناف ويعدّل الكمية المتاحة', en: 'Turn items on/off and set stock' },
  'menu.manage': { group: 'menu', ar: 'يعدّل المنيو بالكامل: أقسام وأصناف وأسعار وصور وعروض', en: 'Edit the whole menu: categories, items, prices, photos, promotions' },
  'store.status': { group: 'menu', ar: 'يفتح أو يوقف استقبال الطلبات', en: 'Open or pause ordering' },
  'store.profile': { group: 'menu', ar: 'يعدّل اسم وشعار وصور ولون المطعم', en: 'Edit the restaurant name, logo, photos and colour' },
  'staff.manage': { group: 'team', ar: 'يضيف ويوقف موظفين المطعم', en: 'Add and block restaurant staff' },
  'reports.view': { group: 'team', ar: 'يشوف مبيعات وتقارير المطعم', en: 'See restaurant sales and reports' },
  'audit.view': { group: 'team', ar: 'يشوف سجل تغييرات المطعم', en: 'See the restaurant change log' },
  'support.manage': { group: 'team', ar: 'يرد على شكاوى وتقييمات المطعم', en: 'Answer the restaurant’s complaints and reviews' },
};

/** Ready-made starting points for a platform employee. */
export const PLATFORM_ROLE_TEMPLATES: { key: string; ar: string; en: string; hintAr: string; hintEn: string; permissions: string[] }[] = [
  { key: 'support', ar: 'خدمة العملاء', en: 'Customer support', hintAr: 'يرد على الشكاوى ويشوف الطلبات ويرجّع فلوس', hintEn: 'Answers complaints, sees orders, handles refunds', permissions: ['platform.support', 'orders.view', 'payments.refund', 'reports.view'] },
  { key: 'accountant', ar: 'محاسب', en: 'Accountant', hintAr: 'المبيعات والتحصيل وعهدة المندوبين', hintEn: 'Sales, settlements and courier cash', permissions: ['platform.finance', 'reports.view', 'orders.view', 'couriers.cash'] },
  { key: 'operations', ar: 'مشرف تشغيل المطاعم', en: 'Restaurant operations', hintAr: 'إعداد المطاعم والمنيو وأوقات التحضير', hintEn: 'Restaurant setup, menus and kitchen timing', permissions: ['platform.restaurants', 'platform.queue', 'orders.view', 'menu.manage', 'menu.availability', 'store.status', 'store.profile'] },
  { key: 'viewer', ar: 'مراقب (عرض فقط)', en: 'Viewer (read only)', hintAr: 'يشوف الطلبات والتقارير والسجل من غير ما يغيّر', hintEn: 'Sees orders, reports and the log without changing anything', permissions: ['orders.view', 'reports.view', 'platform.audit'] },
];
