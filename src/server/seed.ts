/**
 * Seed data: RBAC catalogue (idempotent, safe to re-run on every deploy) + an optional demo restaurant.
 * The demo restaurant is data, not code — nothing in the app refers to it by id or name.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from './db';
import {
  addonGroups,
  addons,
  banners,
  categories,
  deliveryPoints,
  permissions,
  productAddonGroups,
  products,
  productVariants,
  promotions,
  queueConfigs,
  restaurantPaymentMethods,
  restaurants,
  rolePermissions,
  roles,
  storeCounters,
  systemSettings,
  userRoles,
  users,
} from './db/schema';
import { hashPassword } from './auth/password';
import { PERMISSIONS, SYSTEM_ROLES, type Permission } from '../lib/domain/permissions';
import { DEFAULT_QUEUE_CONFIG, type QueueConfig } from '../lib/domain/queue';
import { restaurantBrandSchema } from '../lib/domain/restaurant-brand';

export async function seedRbac(d: Db) {
  for (const [key, def] of Object.entries(PERMISSIONS)) {
    await d
      .insert(permissions)
      .values({ key, description: def.description, scope: def.scope })
      .onConflictDoUpdate({ target: permissions.key, set: { description: def.description, scope: def.scope } });
  }
  for (const role of SYSTEM_ROLES) {
    const [row] = await d
      .insert(roles)
      .values({ key: role.key, name: role.name, description: role.description, scope: role.scope, isSystem: true })
      .onConflictDoUpdate({ target: roles.key, set: { name: role.name, description: role.description, scope: role.scope, isSystem: true } })
      .returning();
    // Only add missing permissions; never strip permissions an admin granted to a system role later.
    const existing = await d.select().from(rolePermissions).where(eq(rolePermissions.roleId, row.id));
    const have = new Set(existing.map((e) => e.permissionKey));
    const missing = role.permissions.filter((p: Permission) => !have.has(p));
    if (missing.length) await d.insert(rolePermissions).values(missing.map((p) => ({ roleId: row.id, permissionKey: p })));
  }
  await d
    .insert(systemSettings)
    .values([
      { key: 'platform.name', value: 'Campus Order' },
      { key: 'platform.timezone', value: 'Africa/Cairo' },
      { key: 'defaults.commissionBps', value: 500 },
      { key: 'defaults.queue', value: DEFAULT_QUEUE_CONFIG },
    ])
    .onConflictDoNothing();
}

export async function roleId(d: Db, key: string): Promise<string> {
  const [r] = await d.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
  if (!r) throw new Error(`Role ${key} missing — run seedRbac first`);
  return r.id;
}

export async function ensureUser(d: Db, opts: { email: string; name: string; password: string }) {
  const email = opts.email.trim().toLowerCase();
  const [existing] = await d.select().from(users).where(eq(users.email, email));
  if (existing) return existing;
  const [created] = await d.insert(users).values({ email, name: opts.name, passwordHash: await hashPassword(opts.password) }).returning();
  return created;
}

export async function assignRole(d: Db, userId: string, roleKey: string, restaurantId: string | null) {
  const rid = await roleId(d, roleKey);
  const where = restaurantId
    ? and(eq(userRoles.userId, userId), eq(userRoles.roleId, rid), eq(userRoles.restaurantId, restaurantId))
    : and(eq(userRoles.userId, userId), eq(userRoles.roleId, rid), isNull(userRoles.restaurantId));
  const [exists] = await d.select().from(userRoles).where(where);
  if (!exists) await d.insert(userRoles).values({ userId, roleId: rid, restaurantId });
}

/** Creates everything a new restaurant needs to take orders (counters, queue config, payment methods). */
export async function bootstrapRestaurant(
  d: Db,
  data: { slug: string; nameAr: string; nameEn: string; commissionBps?: number; phone?: string | null; badgeText?: string | null; badgeTextEn?: string | null; taglineAr?: string | null; taglineEn?: string | null; brandColor?: string; logoUrl?: string | null; coverImageUrl?: string | null },
  queue: QueueConfig = DEFAULT_QUEUE_CONFIG,
  options: { defaultPoints?: boolean } = {},
) {
  const brand = restaurantBrandSchema.parse(data);
  return d.transaction(async (tx) => {
    const [r] = await tx
      .insert(restaurants)
      .values({ ...brand, slug: data.slug, commissionBps: data.commissionBps ?? 500, phone: data.phone ?? null })
      .returning();
    await tx.insert(storeCounters).values({ restaurantId: r.id });
    await tx.insert(queueConfigs).values({ restaurantId: r.id, config: queue });
    await tx.insert(restaurantPaymentMethods).values([
      { restaurantId: r.id, method: 'INSTAPAY', isEnabled: false, config: {}, sortOrder: 0 },
      { restaurantId: r.id, method: 'CASH', isEnabled: true, config: {}, sortOrder: 1 },
    ]);
    if (options.defaultPoints) await tx.insert(deliveryPoints).values([
      { restaurantId: r.id, nameAr: 'بوابة الباركينج — جامعة الإسكندرية الأهلية', nameEn: 'University Parking Gate', fulfillmentType: 'DELIVERY', description: 'Alexandria National University — parking gate', isDefault: true, sortOrder: 0 },
      { restaurantId: r.id, nameAr: 'استلام من المطعم', nameEn: 'Collect from restaurant', fulfillmentType: 'PICKUP', sortOrder: 1 },
    ]);
    return r;
  });
}

const p = (egp: number) => Math.round(egp * 100);

export interface DemoSeedResult {
  restaurantId: string;
  slug: string;
  productIds: Record<string, string>;
  variantIds: Record<string, string>;
  addonIds: Record<string, string>;
  created: boolean;
}

export async function seedDemoRestaurant(d: Db, opts: { demoPassword?: string | null } = {}): Promise<DemoSeedResult> {
  const slug = 'alrayez';
  const [existing] = await d.select().from(restaurants).where(eq(restaurants.slug, slug));
  if (existing) {
    const prods = await d.select().from(products).where(eq(products.restaurantId, existing.id));
    const vars = prods.length ? await d.select().from(productVariants).where(inArray(productVariants.productId, prods.map((x) => x.id))) : [];
    const groups = await d.select().from(addonGroups).where(eq(addonGroups.restaurantId, existing.id));
    const adds = groups.length ? await d.select().from(addons).where(inArray(addons.groupId, groups.map((g) => g.id))) : [];
    return {
      restaurantId: existing.id,
      slug,
      productIds: Object.fromEntries(prods.map((x) => [x.nameEn, x.id])),
      variantIds: Object.fromEntries(vars.map((v) => [`${prods.find((x) => x.id === v.productId)?.nameEn}:${v.nameEn}`, v.id])),
      addonIds: Object.fromEntries(adds.map((a) => [a.nameEn, a.id])),
      created: false,
    };
  }

  const r = await bootstrapRestaurant(d, { slug, nameAr: 'الراية الدمشقية', nameEn: 'Al Raya Al Dimashqia', badgeText: 'الراية', badgeTextEn: 'Al Raya', taglineAr: 'من قلب الشام، لحد عندك', taglineEn: 'From the heart of Damascus, to you', brandColor: '#163d35', coverImageUrl: '/images/restaurant-hero.webp', commissionBps: 500 }, DEFAULT_QUEUE_CONFIG, { defaultPoints: true });
  await d
    .update(restaurantPaymentMethods)
    .set({
      isEnabled: true,
      config: {
        accountName: 'Al Raya Al Dimashqia',
        address: 'alrayez@instapay',
        phone: '01000000000',
        instructions: 'اكتب رقم الطلب في ملاحظة التحويل لو تقدر',
        instructionsEn: 'Add your order number to the transfer note if you can',
      },
    })
    .where(and(eq(restaurantPaymentMethods.restaurantId, r.id), eq(restaurantPaymentMethods.method, 'INSTAPAY')));

  const [sandwiches, meals, sides, drinks] = await d
    .insert(categories)
    .values([
      { restaurantId: r.id, nameAr: 'ساندوتشات', nameEn: 'Sandwiches', sortOrder: 1 },
      { restaurantId: r.id, nameAr: 'وجبات', nameEn: 'Meals', sortOrder: 2 },
      { restaurantId: r.id, nameAr: 'إضافات جانبية', nameEn: 'Sides', sortOrder: 3 },
      { restaurantId: r.id, nameAr: 'مشروبات', nameEn: 'Drinks', sortOrder: 4 },
    ])
    .returning();

  const productRows = await d
    .insert(products)
    .values([
      { restaurantId: r.id, categoryId: sandwiches.id, nameAr: 'ساندوتش شاورما فراخ', nameEn: 'Chicken Shawarma Sandwich', descriptionAr: 'شاورما فراخ بالثومية والمخلل', descriptionEn: 'Chicken shawarma with garlic sauce and pickles', imageUrl: '/images/chicken-shawarma.webp', basePrice: p(60), prepLoadUnits: 1, sortOrder: 1 },
      { restaurantId: r.id, categoryId: sandwiches.id, nameAr: 'ساندوتش شاورما لحمة', nameEn: 'Meat Shawarma Sandwich', descriptionAr: 'شاورما لحمة بالطحينة', descriptionEn: 'Beef shawarma with tahini sauce', imageUrl: '/images/beef-shawarma.webp', basePrice: p(75), prepLoadUnits: 1, sortOrder: 2 },
      { restaurantId: r.id, categoryId: meals.id, nameAr: 'وجبة شاورما', nameEn: 'Shawarma Meal', descriptionAr: 'شاورما عربي + بطاطس + ثومية + مخلل', descriptionEn: 'Arabic shawarma, fries, garlic sauce and pickles', imageUrl: '/images/chicken-shawarma.webp', basePrice: p(140), prepLoadUnits: 2, sortOrder: 1 },
      { restaurantId: r.id, categoryId: sides.id, nameAr: 'بطاطس', nameEn: 'Fries', basePrice: p(35), prepLoadUnits: 1, sortOrder: 1 },
      { restaurantId: r.id, categoryId: drinks.id, nameAr: 'مشروب غازي', nameEn: 'Soft Drink', basePrice: p(20), prepLoadUnits: 0, sortOrder: 1 },
    ])
    .returning();
  const byName = Object.fromEntries(productRows.map((x) => [x.nameEn, x]));

  const variantRows = await d
    .insert(productVariants)
    .values([
      { productId: byName['Chicken Shawarma Sandwich'].id, nameAr: 'عادي', nameEn: 'Regular', price: p(60), isDefault: true, sortOrder: 1 },
      { productId: byName['Chicken Shawarma Sandwich'].id, nameAr: 'كبير', nameEn: 'Large', price: p(80), sortOrder: 2 },
      { productId: byName['Meat Shawarma Sandwich'].id, nameAr: 'عادي', nameEn: 'Regular', price: p(75), isDefault: true, sortOrder: 1 },
      { productId: byName['Meat Shawarma Sandwich'].id, nameAr: 'كبير', nameEn: 'Large', price: p(95), sortOrder: 2 },
      { productId: byName['Meat Shawarma Sandwich'].id, nameAr: 'سوبر (دبل)', nameEn: 'Super (double)', price: p(120), sortOrder: 3, prepLoadUnits: 2 },
    ])
    .returning();

  const [extras] = await d
    .insert(addonGroups)
    .values({ restaurantId: r.id, nameAr: 'إضافات الساندوتش', nameEn: 'Sandwich extras', minSelect: 0, maxSelect: 3, sortOrder: 1 })
    .returning();
  const addonRows = await d
    .insert(addons)
    .values([
      { groupId: extras.id, nameAr: 'ثومية زيادة', nameEn: 'Extra garlic', price: p(5), sortOrder: 1 },
      { groupId: extras.id, nameAr: 'جبنة', nameEn: 'Cheese', price: p(10), sortOrder: 2 },
      { groupId: extras.id, nameAr: 'بطاطس جوه الساندوتش', nameEn: 'Fries inside', price: p(5), sortOrder: 3 },
    ])
    .returning();
  await d.insert(productAddonGroups).values([
    { productId: byName['Chicken Shawarma Sandwich'].id, groupId: extras.id },
    { productId: byName['Meat Shawarma Sandwich'].id, groupId: extras.id },
  ]);

  const [welcome] = await d
    .insert(promotions)
    .values([
      { restaurantId: r.id, name: 'Welcome 10%', type: 'PERCENT', value: 1000, code: 'WELCOME10', minSubtotal: p(100), maxDiscount: p(30) },
      { restaurantId: r.id, name: 'Order now — pick up at the gate', type: 'BANNER_ONLY', value: 0 },
    ])
    .returning();
  await d.insert(banners).values([
    { restaurantId: r.id, titleAr: 'طعم شامي، على أصوله', titleEn: 'Authentic Syrian flavour', subtitleAr: 'شاورما معمولة بحب. اطلب دلوقتي واستلم عند بوابة الجامعة.', subtitleEn: 'Shawarma made with care. Order now and collect at the university gate.', imageUrl: '/images/restaurant-hero.webp', bgColor: '#163d35', sortOrder: 1 },
    { restaurantId: r.id, titleAr: 'خصم 10% على طلبك', titleEn: '10% off your order', subtitleAr: 'استخدم كود WELCOME10 (من 100 ج.م)', subtitleEn: 'Use WELCOME10 on orders of EGP 100 or more', bgColor: '#166534', promotionId: welcome.id, sortOrder: 2 },
  ]);

  if (opts.demoPassword) {
    const staff = [
      { email: 'owner@alrayez.test', name: 'صاحب المحل', role: 'MERCHANT_OWNER' },
      { email: 'cashier@alrayez.test', name: 'الكاشير', role: 'CASHIER' },
      { email: 'kitchen@alrayez.test', name: 'المطبخ', role: 'KITCHEN_STAFF' },
      { email: 'delivery@alrayez.test', name: 'الدليفري', role: 'DELIVERY_STAFF' },
    ];
    for (const s of staff) {
      const u = await ensureUser(d, { email: s.email, name: s.name, password: opts.demoPassword });
      await assignRole(d, u.id, s.role, r.id);
    }
  }

  return {
    restaurantId: r.id,
    slug,
    productIds: Object.fromEntries(productRows.map((x) => [x.nameEn, x.id])),
    variantIds: Object.fromEntries(variantRows.map((v) => [`${productRows.find((x) => x.id === v.productId)?.nameEn}:${v.nameEn}`, v.id])),
    addonIds: Object.fromEntries(addonRows.map((a) => [a.nameEn, a.id])),
    created: true,
  };
}
