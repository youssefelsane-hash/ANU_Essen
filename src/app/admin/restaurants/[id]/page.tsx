import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/server/db';
import { deliveryPoints, restaurantPaymentMethods } from '@/server/db/schema';
import { adminPage } from '@/server/admin-guard';
import { getRestaurant } from '@/server/services/store';
import { saveDeliveryPointAction, updatePaymentMethodAction, updateRestaurantAction } from '@/server/actions/admin-restaurants';
import { ActionForm, SubmitButton } from '@/components/forms';
import { HoursEditor } from '@/components/admin/editors';
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
        <a href={`/s/${r.slug}`} target="_blank" className="btn btn-secondary btn-sm">Open customer menu ↗</a>
      </PageTitle>
      <RestaurantTabs id={id} active="settings" />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-bold">General</h2>
          <ActionForm action={updateRestaurantAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={r.id} />
            <Field label="Name (Arabic)"><input name="nameAr" defaultValue={r.nameAr} className="input" dir="rtl" required /></Field>
            <Field label="Name (English)"><input name="nameEn" defaultValue={r.nameEn} className="input" required /></Field>
            <Field label="URL slug (/s/…)"><input name="slug" defaultValue={r.slug} className="input" required /></Field>
            <Field label="Phone (shown to customers)"><input name="phone" defaultValue={r.phone ?? ''} className="input" /></Field>
            <Field label="Logo URL"><input name="logoUrl" defaultValue={r.logoUrl ?? ''} className="input" /></Field>
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
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={r.isActive} /> Restaurant active</label>
            <div className="sm:col-span-2">
              <label className="label">Opening hours ({r.timezone})</label>
              <HoursEditor name="openingHours" initial={r.openingHours ?? null} />
            </div>
            <div className="sm:col-span-2"><SubmitButton>Save settings</SubmitButton></div>
          </ActionForm>
          <p className="mt-3 text-xs text-gray-500">Commission changes apply to new orders only — every order stores a snapshot of the rate it was created with.</p>
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
