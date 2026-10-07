import { asc, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { banners, products, promotions } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant } from '@/server/services/store';
import { deleteBannerAction, saveBannerAction, savePromotionAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { QrGenerator } from '@/components/admin/qr-generator';
import { Forbidden, PageTitle, RestaurantTabs } from '@/components/admin/ui';
import { PROMOTION_TYPES } from '@/lib/domain/pricing';
import { toZonedInputValue } from '@/lib/domain/hours';

export const dynamic = 'force-dynamic';


export default async function MarketingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (!(await adminPage(`/admin/restaurants/${id}/marketing`, 'platform.restaurants'))) return <Forbidden />;
  const r = await getRestaurant(db(), id);
  if (!r) notFound();
  const [bannerRows, promoRows, productRows] = await Promise.all([
    db().select().from(banners).where(eq(banners.restaurantId, id)).orderBy(asc(banners.sortOrder)),
    db().select().from(promotions).where(eq(promotions.restaurantId, id)).orderBy(desc(promotions.createdAt)),
    db().select({ id: products.id, nameEn: products.nameEn }).from(products).where(eq(products.restaurantId, id)),
  ]);

  return (
    <div>
      <PageTitle title={`${r.nameEn} — Banners, promotions & QR`} />
      <RestaurantTabs id={id} active="marketing" />
      <div className="space-y-6">
        <section className="card">
          <h2 className="mb-3 font-bold">QR code for posters</h2>
          <QrGenerator slug={r.slug} baseUrl={process.env.APP_URL ?? null} />
        </section>

        <section className="card">
          <h2 className="mb-3 font-bold">Promotional banners (shown on the menu) — times in {r.timezone}</h2>
          <div className="space-y-3">
            {[...bannerRows, null].map((b, i) => (
              <div key={b?.id ?? `new-${i}`} className="rounded-xl bg-gray-50 p-3">
                <ActionForm action={saveBannerAction} className="grid gap-2 md:grid-cols-4">
                  <input type="hidden" name="restaurantId" value={id} />
                  <input type="hidden" name="id" value={b?.id ?? ''} />
                  <input name="titleAr" defaultValue={b?.titleAr ?? ''} placeholder="العنوان" className="input md:col-span-2" dir="rtl" required />
                  <input name="subtitleAr" defaultValue={b?.subtitleAr ?? ''} placeholder="سطر إضافي" className="input md:col-span-2" dir="rtl" />
                  <input name="imageUrl" defaultValue={b?.imageUrl ?? ''} placeholder="Image URL (optional)" className="input md:col-span-2" />
                  <label className="text-xs">Background <input type="color" name="bgColor" defaultValue={b?.bgColor ?? '#c2410c'} className="h-9 w-full" /></label>
                  <label className="text-xs">Text <input type="color" name="textColor" defaultValue={b?.textColor ?? '#ffffff'} className="h-9 w-full" /></label>
                  <label className="text-xs">Starts <input type="datetime-local" name="startsAt" defaultValue={toZonedInputValue(b?.startsAt, r.timezone)} className="input py-1" /></label>
                  <label className="text-xs">Ends <input type="datetime-local" name="endsAt" defaultValue={toZonedInputValue(b?.endsAt, r.timezone)} className="input py-1" /></label>
                  <label className="text-xs">Sort <input name="sortOrder" defaultValue={b?.sortOrder ?? bannerRows.length + 1} className="input py-1" /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={b?.isActive ?? true} /> Active</label>
                  <div className="md:col-span-4"><SubmitButton className="btn btn-secondary btn-sm">{b ? 'Save banner' : 'Add banner'}</SubmitButton></div>
                </ActionForm>
                {b && (
                  <form action={deleteBannerAction.bind(null, id, b.id)} className="mt-1">
                    <button className="btn btn-ghost btn-sm text-red-600">Delete banner</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="mb-1 font-bold">Promotions</h2>
          <p className="mb-3 text-xs text-gray-500">Percent types: value in %. Fixed types: value in EGP. A promotion with a code applies only when the customer enters it; without a code, tick “auto-apply”. One promotion per order (the best one).</p>
          <div className="space-y-3">
            {[...promoRows, null].map((p, i) => {
              const isPct = p?.type === 'PERCENT' || p?.type === 'PRODUCT_PERCENT';
              return (
                <ActionForm key={p?.id ?? `new-${i}`} action={savePromotionAction} className="grid gap-2 rounded-xl bg-gray-50 p-3 md:grid-cols-4">
                  <input type="hidden" name="restaurantId" value={id} />
                  <input type="hidden" name="id" value={p?.id ?? ''} />
                  <input name="name" defaultValue={p?.name ?? ''} placeholder="Internal name" className="input" required />
                  <select name="type" defaultValue={p?.type ?? 'PERCENT'} className="input">
                    {PROMOTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input name="value" defaultValue={p ? (isPct ? p.value / 100 : p.value / 100) : ''} placeholder="Value (% or EGP)" className="input" />
                  <input name="code" defaultValue={p?.code ?? ''} placeholder="CODE (optional)" className="input uppercase" />
                  <select name="productId" defaultValue={p?.productId ?? ''} className="input">
                    <option value="">— product (for PRODUCT_*) —</option>
                    {productRows.map((x) => <option key={x.id} value={x.id}>{x.nameEn}</option>)}
                  </select>
                  <input name="minSubtotal" defaultValue={p ? p.minSubtotal / 100 : ''} placeholder="Min order EGP" className="input" />
                  <input name="maxDiscount" defaultValue={p?.maxDiscount != null ? p.maxDiscount / 100 : ''} placeholder="Max discount EGP" className="input" />
                  <input name="usageLimit" defaultValue={p?.usageLimit ?? ''} placeholder="Usage limit" className="input" />
                  <label className="text-xs">Starts <input type="datetime-local" name="startsAt" defaultValue={toZonedInputValue(p?.startsAt, r.timezone)} className="input py-1" /></label>
                  <label className="text-xs">Ends <input type="datetime-local" name="endsAt" defaultValue={toZonedInputValue(p?.endsAt, r.timezone)} className="input py-1" /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoApply" defaultChecked={p?.autoApply ?? false} /> Auto-apply</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} /> Active</label>
                  <div className="flex items-center gap-3 md:col-span-4">
                    <SubmitButton className="btn btn-secondary btn-sm">{p ? 'Save' : 'Add promotion'}</SubmitButton>
                    {p && <span className="text-xs text-gray-500">Used {p.usedCount}{p.usageLimit ? ` / ${p.usageLimit}` : ''} times</span>}
                  </div>
                </ActionForm>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
