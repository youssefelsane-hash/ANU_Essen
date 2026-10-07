import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { deliveryPoints, restaurantPaymentMethods } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant } from '@/server/services/store';
import { resumeRestaurantAction, saveDeliveryPointAction, suspendRestaurantAction, updatePaymentMethodAction, updateRestaurantAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { HoursEditor } from '@/components/admin/editors';
import { RestaurantBrandEditor } from '@/components/admin/restaurant-brand-editor';
import { Forbidden, PageTitle, RestaurantTabs } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export default async function RestaurantSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (!(await adminPage(`/admin/restaurants/${id}`, 'platform.restaurants'))) return <Forbidden />;
  const r = await getRestaurant(db(), id);
  if (!r) notFound();
  const [methods, points] = await Promise.all([
    db().select().from(restaurantPaymentMethods).where(eq(restaurantPaymentMethods.restaurantId, id)),
    db().select().from(deliveryPoints).where(eq(deliveryPoints.restaurantId, id)).orderBy(asc(deliveryPoints.sortOrder)),
  ]);
  const instapay = methods.find((m) => m.method === 'INSTAPAY');
  const cash = methods.find((m) => m.method === 'CASH');

  return (
    <div>
      <PageTitle title={r.nameEn} subtitle={r.nameAr}>
        <a href={`/s/${r.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">Open customer menu ↗</a>
      </PageTitle>
      <RestaurantTabs id={id} active="settings" />
      <ServiceStatus restaurant={r} />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card">
          <h2 className="mb-1 font-bold">Restaurant identity & operations</h2>
          <p className="mb-5 text-sm text-gray-500">Give each restaurant its own name, badge, photos and color. The preview updates as you edit.</p>
          <ActionForm action={updateRestaurantAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={r.id} />
            <div className="mb-3 sm:col-span-2"><RestaurantBrandEditor initial={r} /></div>
            <Field label="URL slug (/s/…)"><input name="slug" defaultValue={r.slug} maxLength={48} className="input" required /><p className="mt-1 text-[11px] text-gray-500">Changing this updates direct menu links. Permanent QR links keep working.</p></Field>
            <Field label="Phone (shown to customers)"><input name="phone" defaultValue={r.phone ?? ''} className="input" /></Field>
            <Field label="Timezone"><input name="timezone" defaultValue={r.timezone} className="input" /></Field>
            <Field label="Ordering status">
              <select name="orderingStatus" defaultValue={r.orderingStatus} className="input">
                <option value="OPEN">OPEN</option>
                <option value="PAUSED">PAUSED</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </Field>
            <Field label="Minimum order (EGP)"><input name="minOrder" defaultValue={r.minOrderAmount / 100} className="input" inputMode="decimal" /></Field>
            <Field label="Platform commission (%)"><input name="commissionPercent" defaultValue={r.commissionBps / 100} className="input" inputMode="decimal" /></Field>
            <Field label="Cancel unpaid InstaPay orders after (min, 0 = never)"><input name="unpaidTimeoutMinutes" defaultValue={r.unpaidTimeoutMinutes} className="input" inputMode="numeric" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requirePhone" defaultChecked={r.requirePhone} /> Phone number required at checkout</label>
            <div className="sm:col-span-2">
              <label className="label">Opening hours ({r.timezone})</label>
              <HoursEditor name="openingHours" initial={r.openingHours ?? null} />
            </div>
            <div className="sm:col-span-2"><SubmitButton>Save settings</SubmitButton></div>
          </ActionForm>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">Your QR poster uses a permanent restaurant link, so renaming or changing the slug keeps printed codes working. Commission changes apply to new orders; each order keeps its original rate.</p>
        </section>

        <div className="space-y-6">
          <section className="card">
            <h2 className="mb-3 font-bold">InstaPay</h2>
            <ActionForm action={updatePaymentMethodAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="restaurantId" value={r.id} />
              <input type="hidden" name="method" value="INSTAPAY" />
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="isEnabled" defaultChecked={instapay?.isEnabled ?? false} /> InstaPay enabled</label>
              <Field label="Account name"><input name="accountName" defaultValue={instapay?.config.accountName ?? ''} className="input" /></Field>
              <Field label="InstaPay address (name@instapay)"><input name="address" defaultValue={instapay?.config.address ?? ''} className="input" /></Field>
              <Field label="Mobile number"><input name="phone" defaultValue={instapay?.config.phone ?? ''} className="input" /></Field>
              <Field label="Payment link (optional)"><input name="link" defaultValue={instapay?.config.link ?? ''} className="input" /></Field>
              <div className="sm:col-span-2"><Field label="Instructions for the customer (Arabic)"><input name="instructions" defaultValue={instapay?.config.instructions ?? ''} className="input" dir="rtl" /></Field></div>
              <div className="sm:col-span-2"><SubmitButton>Save InstaPay</SubmitButton></div>
            </ActionForm>
            <p className="mt-2 text-xs text-gray-500">No InstaPay API is assumed: staff verify transfers manually on the merchant screen.</p>
          </section>
          <section className="card">
            <h2 className="mb-3 font-bold">Cash on delivery</h2>
            <ActionForm action={updatePaymentMethodAction} className="flex items-center justify-between gap-3">
              <input type="hidden" name="restaurantId" value={r.id} />
              <input type="hidden" name="method" value="CASH" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isEnabled" defaultChecked={cash?.isEnabled ?? false} /> Cash enabled</label>
              <SubmitButton className="btn btn-secondary btn-sm">Save</SubmitButton>
            </ActionForm>
          </section>
          <section className="card">
            <h2 className="mb-3 font-bold">Delivery points</h2>
            <div className="space-y-4">
              {[...points, null].map((p, i) => (
                <ActionForm key={p?.id ?? `new-${i}`} action={saveDeliveryPointAction} className="grid gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-2">
                  <input type="hidden" name="restaurantId" value={r.id} />
                  <input type="hidden" name="id" value={p?.id ?? ''} />
                  <div className="text-xs font-semibold text-gray-500 sm:col-span-2">{p ? 'Delivery point' : 'Add delivery point'}</div>
                  <input name="nameAr" defaultValue={p?.nameAr ?? ''} placeholder="Name (Arabic)" className="input" dir="rtl" required />
                  <input name="nameEn" defaultValue={p?.nameEn ?? ''} placeholder="Name (English)" className="input" required />
                  <Field label="Delivery fee (EGP)"><input name="deliveryFee" defaultValue={(p?.deliveryFee ?? 0) / 100} className="input" /></Field>
                  <Field label="Extra delivery minutes"><input name="extraMinutes" defaultValue={p?.extraMinutes ?? 0} className="input" /></Field>
                  <input type="hidden" name="sortOrder" value={p?.sortOrder ?? points.length} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={p?.isDefault ?? points.length === 0} /> Default</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} /> Active</label>
                  <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary btn-sm">{p ? 'Save' : 'Add'}</SubmitButton></div>
                </ActionForm>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ServiceStatus({ restaurant: r }: { restaurant: { id: string; isActive: boolean; suspendedReason: string | null; suspendedAt: Date | null } }) {
  if (!r.isActive) {
    return (
      <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-red-300 bg-red-50 p-4">
        <div>
          <h2 className="font-bold text-red-800">Service suspended · الخدمة موقوفة</h2>
          <p className="text-sm text-red-700">
            Customers can&apos;t order and the restaurant can&apos;t reopen. Orders already in progress can still be finished.
            {r.suspendedReason && <> Reason: <b>{r.suspendedReason}</b></>}
            {r.suspendedAt && <> · since {r.suspendedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</>}
          </p>
        </div>
        <form action={resumeRestaurantAction.bind(null, r.id)}>
          <button className="btn btn-success">Resume service · تشغيل الخدمة</button>
        </form>
      </section>
    );
  }
  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          <span className="me-2 inline-block size-2 rounded-full bg-emerald-500" />Service active · Suspend this restaurant…
        </summary>
        <ActionForm action={suspendRestaurantAction} className="mt-3 flex flex-wrap items-end gap-2" confirm="Suspend this restaurant? Customers will not be able to order until you resume it.">
          <input type="hidden" name="restaurantId" value={r.id} />
          <label className="min-w-64 flex-1">
            <span className="label">Reason (shown on the restaurant&apos;s screen)</span>
            <input name="reason" required minLength={3} maxLength={200} className="input" placeholder="e.g. commission overdue / contract paused" />
          </label>
          <SubmitButton className="btn btn-danger">Suspend service · إيقاف الخدمة</SubmitButton>
        </ActionForm>
      </details>
    </section>
  );
}
