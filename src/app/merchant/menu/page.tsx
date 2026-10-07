import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/server/db';
import { addonGroups, addons, categories, products, productVariants } from '@/server/db/schema';
import { merchantContext } from '@/server/merchant-context';
import { setAddonAvailability, setProductAvailability, setVariantAvailability, updatePriceAction } from '@/server/actions/merchant';
import { ActionForm, SubmitButton } from '@/components/forms';
import { formatMoney } from '@/lib/domain/misc';
import { getLocale } from '@/lib/i18n/server';
import { text, localizedName, type Locale } from '@/lib/i18n';
import { AvailabilityToggle } from '@/components/merchant/availability-toggle';

export const dynamic = 'force-dynamic';

function PriceEditor({ kind, id, price, locale }: { kind: 'product' | 'variant'; id: string; price: number; locale: Locale }) {
  return (
    <ActionForm action={updatePriceAction} className="flex items-center gap-1">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input name="price" defaultValue={price / 100} inputMode="decimal" className="input w-20 py-1" aria-label={text(locale, 'السعر بالجنيه', 'Price in EGP')} />
      <SubmitButton className="btn btn-secondary btn-sm">{text(locale, 'حفظ السعر', 'Save price')}</SubmitButton>
    </ActionForm>
  );
}

export default async function MerchantMenuPage() {
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const { restaurant, permissions } = await merchantContext('/merchant/menu');
  if (!restaurant || !(permissions.has('menu.availability') || permissions.has('menu.manage'))) return <p className="p-6 text-center">{t('لا تملك صلاحية تعديل الأصناف.', 'You do not have permission to edit the menu.')}</p>;
  const canToggle = permissions.has('menu.availability');
  const canPrice = permissions.has('menu.manage');
  const [cats, prods, groups] = await Promise.all([
    db().select().from(categories).where(eq(categories.restaurantId, restaurant.id)).orderBy(asc(categories.sortOrder)),
    db().select().from(products).where(eq(products.restaurantId, restaurant.id)).orderBy(asc(products.sortOrder)),
    db().select().from(addonGroups).where(eq(addonGroups.restaurantId, restaurant.id)).orderBy(asc(addonGroups.sortOrder)),
  ]);
  const variants = prods.length ? await db().select().from(productVariants).where(inArray(productVariants.productId, prods.map((p) => p.id))).orderBy(asc(productVariants.sortOrder)) : [];
  const addonRows = groups.length ? await db().select().from(addons).where(inArray(addons.groupId, groups.map((g) => g.id))).orderBy(asc(addons.sortOrder)) : [];

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4">
      <h1 className="text-2xl font-extrabold">{t('الأصناف والأسعار', 'Menu & prices')}</h1>
      <p className="text-sm text-gray-500">{t('اضغط على حالة الصنف لإتاحته أو إيقافه. العملاء لا يمكنهم طلب الأصناف غير المتاحة.', 'Tap an item’s availability to turn it on or off. Customers cannot order unavailable items.')}</p>
      {cats.map((c) => (
        <section key={c.id} className="card">
          <h2 className="mb-3 text-lg font-bold">{localizedName(locale, c.nameAr, c.nameEn)}</h2>
          <div className="divide-y divide-gray-100">
            {prods.filter((p) => p.categoryId === c.id && p.isActive).map((p) => {
              const vs = variants.filter((v) => v.productId === p.id);
              return (
                <div key={p.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">{localizedName(locale, p.nameAr, p.nameEn)}</div>
                      <div className="text-xs text-gray-500">{vs.length ? t(`${vs.length} أحجام`, `${vs.length} sizes`) : formatMoney(p.basePrice, locale)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canPrice && vs.length === 0 && <PriceEditor kind="product" id={p.id} price={p.basePrice} locale={locale} />}
                      {canToggle && <AvailabilityToggle on={p.isAvailable} action={setProductAvailability.bind(null, p.id, !p.isAvailable)} label={localizedName(locale, p.nameAr, p.nameEn)} />}
                    </div>
                  </div>
                  {vs.length > 0 && (
                    <div className="mt-2 space-y-1 ps-4">
                      {vs.map((v) => (
                        <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span>— {localizedName(locale, v.nameAr, v.nameEn)} <span className="text-gray-500">{formatMoney(v.price, locale)}</span></span>
                          <div className="flex items-center gap-2">
                            {canPrice && <PriceEditor kind="variant" id={v.id} price={v.price} locale={locale} />}
                            {canToggle && <AvailabilityToggle on={v.isAvailable} action={setVariantAvailability.bind(null, v.id, !v.isAvailable)} label={localizedName(locale, v.nameAr, v.nameEn)} />}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {groups.map((g) => (
        <section key={g.id} className="card">
          <h2 className="mb-3 text-lg font-bold">{localizedName(locale, g.nameAr, g.nameEn)}</h2>
          <div className="divide-y divide-gray-100">
            {addonRows.filter((a) => a.groupId === g.id).map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span>{localizedName(locale, a.nameAr, a.nameEn)} <span className="text-gray-500">{formatMoney(a.price, locale)}</span></span>
                {canToggle && <AvailabilityToggle on={a.isAvailable} action={setAddonAvailability.bind(null, a.id, !a.isAvailable)} label={localizedName(locale, a.nameAr, a.nameEn)} />}
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
