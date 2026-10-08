'use client';

import { startTransition, useActionState, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, ShieldCheck, Truck, UserRound } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { initialActionState } from '@/lib/action-state';
import { localizedName, localizeMessage } from '@/lib/i18n';
import { createCourierAction, setCourierRestaurantsAction } from '@/server/actions/couriers';
import type { platformCourierOverview } from '@/server/services/couriers';

type Overview = Awaited<ReturnType<typeof platformCourierOverview>>;
type Restaurant = Overview['restaurants'][number];
type Courier = Overview['couriers'][number];

export function CourierManagement({ couriers, candidates, restaurants, actorUserId }: Pick<Overview, 'couriers' | 'candidates' | 'restaurants'> & { actorUserId: string }) {
  const { locale, t } = useLanguage();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [existingId, setExistingId] = useState('');
  const candidate = candidates.find((user) => user.userId === existingId);
  const existing = couriers.find((user) => user.userId === existingId);
  return <div className="space-y-5">
    <section className="card space-y-4">
      <div><h2 className="text-lg font-bold">{t('إضافة مندوب للمطاعم', 'Add a restaurant courier')}</h2><p className="mt-1 text-sm leading-6 text-gray-600">{t('حساب واحد للمندوب. اختار المطاعم اللي يشتغل معها؛ هتظهر طلباتها مع بعض في شاشة التوصيل.', 'One account for the courier. Choose the restaurants they work with; their deliveries appear together.')}</p></div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('طريقة الإضافة', 'How to add a courier')}>
        <button type="button" className={`btn min-h-12 ${mode === 'new' ? 'btn-dark' : 'btn-secondary'}`} aria-pressed={mode === 'new'} onClick={() => setMode('new')}><Plus size={18} />{t('مندوب جديد', 'New courier')}</button>
        <button type="button" className={`btn min-h-12 ${mode === 'existing' ? 'btn-dark' : 'btn-secondary'}`} aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}><UserRound size={18} />{t('حساب موجود', 'Existing account')}</button>
      </div>
      {mode === 'new' ? <CourierAccessForm key={`new:${actorUserId}`} actorUserId={actorUserId} restaurants={restaurants} /> : <div className="space-y-4">
        <label className="block"><span className="label">{t('اختار الحساب', 'Choose the account')}</span><select className="input" value={existingId} onChange={(event) => setExistingId(event.target.value)}><option value="">{t('اختار شخصًا', 'Choose a person')}</option>{candidates.map((user) => <option key={user.userId} value={user.userId}>{user.name} · {user.email}{!user.isActive ? t(' · محظور', ' · blocked') : ''}</option>)}</select></label>
        {candidate && <CourierAccessForm key={`${actorUserId}:${candidate.userId}`} actorUserId={actorUserId} restaurants={restaurants} courier={{ ...candidate, restaurantIds: existing?.restaurantIds ?? [] }} />}
        {!candidates.length && <p className="text-sm text-gray-500">{t('مفيش حسابات متاحة حاليًا. أضف مندوبًا جديدًا.', 'No accounts are available yet. Add a new courier.')}</p>}
      </div>}
    </section>
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Truck size={20} />{t('المندوبون والمطاعم المسموحة', 'Couriers and their restaurant access')} <span className="badge bg-gray-100 text-gray-700">{couriers.length}</span></h2>
      {couriers.map((courier) => <details key={courier.userId} className="card">
        <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><strong className="block break-words text-base" dir="auto">{courier.name}</strong><span className="block break-all text-xs text-gray-500" dir="ltr">{courier.email}</span></div><span className={`badge ${courier.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{courier.isActive ? t('نشط', 'Active') : t('محظور', 'Blocked')}</span></div><div className="mt-3 flex flex-wrap gap-2">{courier.restaurantIds.map((id) => { const restaurant = restaurants.find((item) => item.id === id); return <span key={id} className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold">{restaurant ? localizedName(locale, restaurant.nameAr, restaurant.nameEn) : t('مطعم غير متاح', 'Unavailable restaurant')}</span>; })}{!courier.restaurantIds.length && <span className="text-sm text-gray-500">{t('لا توجد مطاعم مسموحة حاليًا', 'No restaurant access currently')}</span>}</div><span className="mt-3 inline-block text-sm font-semibold text-emerald-800">{t('تعديل المطاعم المسموحة', 'Edit restaurant access')} ↓</span></summary>
        <div className="mt-4 border-t border-gray-100 pt-4"><CourierAccessForm key={`${actorUserId}:${courier.userId}`} actorUserId={actorUserId} restaurants={restaurants} courier={courier} /></div>
      </details>)}
      {!couriers.length && <div className="card py-8 text-center text-sm text-gray-500">{t('لم تتم إضافة مندوبين بعد. ابدأ بالنموذج بالأعلى.', 'No couriers yet. Start with the form above.')}</div>}
    </section>
  </div>;
}

function CourierAccessForm({ restaurants, courier, actorUserId }: { restaurants: Restaurant[]; courier?: Courier; actorUserId: string }) {
  const { locale, t } = useLanguage();
  const prefix = useId();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const [selected, setSelected] = useState(courier?.restaurantIds ?? []);
  const [state, formAction, pending] = useActionState(courier ? setCourierRestaurantsAction : createCourierAction, initialActionState);
  const initialSelection = (courier?.restaurantIds ?? []).slice().sort().join(',');
  useEffect(() => { setSelected(courier?.restaurantIds ?? []); }, [initialSelection]);
  useEffect(() => {
    if (!state.at) return;
    submitting.current = false;
    if (state.ok && !courier) { form.current?.reset(); setSelected([]); }
    // Re-read authorization as well as data, so revoked controls disappear after a rejected action.
    router.refresh();
  }, [state.at]);
  const allowed = restaurants.filter((restaurant) => selected.includes(restaurant.id));
  const blocked = courier?.isActive === false;
  return <form ref={form} action={formAction} className="space-y-4" onSubmit={(event) => {
    event.preventDefault();
    if (pending || submitting.current) return;
    submitting.current = true;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }}>
    <input type="hidden" name="actorUserId" value={actorUserId} />
    {courier && <input type="hidden" name="userId" value={courier.userId} />}
    <fieldset disabled={pending} className="min-w-0 space-y-4">
      {!courier && <div className="grid gap-3 sm:grid-cols-2"><label><span className="label">{t('اسم المندوب', 'Courier name')}</span><input name="name" className="input" required minLength={2} maxLength={80} autoComplete="name" /></label><label><span className="label">{t('البريد المستخدم للدخول', 'Sign-in email')}</span><input name="email" className="input" type="email" dir="ltr" required maxLength={254} autoComplete="email" /></label><label><span className="label">{t('كلمة المرور · 8 أحرف على الأقل', 'Password · at least 8 characters')}</span><input name="password" className="input" type="password" dir="ltr" required minLength={8} maxLength={200} autoComplete="new-password" /></label><label><span className="label">{t('رقم الموبايل · اختياري', 'Phone · optional')}</span><input name="phone" className="input" type="tel" dir="ltr" maxLength={30} autoComplete="tel" /></label></div>}
      {blocked && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('الحساب محظور. تعديل المطاعم لا يلغي الحظر؛ راجع حالة الحساب من صفحة المستخدمين قبل بدء العمل.', 'This account is blocked. Editing its restaurants keeps it blocked; review its status on the Team members page before work starts.')}</p>}
      <fieldset className="space-y-2"><legend className="label">{t('اختار المطاعم المسموحة', 'Choose allowed restaurants')}</legend><div className="grid max-h-80 gap-2 overflow-y-auto p-1 sm:grid-cols-2">{restaurants.map((restaurant) => <label key={restaurant.id} htmlFor={`${prefix}-${restaurant.id}`} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 ${selected.includes(restaurant.id) ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white'}`}><input id={`${prefix}-${restaurant.id}`} type="checkbox" className="h-5 w-5 shrink-0 accent-emerald-800" name="restaurantIds" value={restaurant.id} checked={selected.includes(restaurant.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, restaurant.id])] : current.filter((id) => id !== restaurant.id))} /><span className="min-w-0 text-sm font-semibold">{localizedName(locale, restaurant.nameAr, restaurant.nameEn)}{!restaurant.isActive && <small className="ms-2 font-normal text-amber-800">{t('الخدمة موقوفة', 'Service suspended')}</small>}</span></label>)}</div>{!restaurants.length && <p className="text-sm text-gray-500">{t('أضف مطعمًا أولًا.', 'Add a restaurant first.')}</p>}</fieldset>
      <div className={`rounded-xl p-3 ${allowed.length ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'}`} role="status"><p className="flex items-center gap-2 text-sm font-bold"><ShieldCheck size={18} />{t('الصلاحية بعد الحفظ', 'Access after saving')}</p><p className="mt-2 text-sm leading-6">{allowed.length ? t(`توصيل طلبات ${allowed.length} مطعم: `, `Deliver orders for ${allowed.length} restaurant(s): `) + allowed.map((restaurant) => localizedName(locale, restaurant.nameAr, restaurant.nameEn)).join(locale === 'ar' ? '، ' : ', ') : t('لن يكون للحساب وصول للتوصيل في أي مطعم.', 'This account will have no courier access to any restaurant.')}</p><p className="mt-1 text-xs leading-5">{t('يشمل ذلك عرض طلبات التوصيل وبيانات استلامها، وتسجيل خروجها وتسليمها وتحصيل الكاش. تظل أدوار الحساب الأخرى كما هي.', 'This grants access to delivery orders and recipient details, dispatch, delivery and cash collection. Other account roles stay as they are.')}</p></div>
    </fieldset>
    {state.error && <p className="text-sm font-semibold text-red-700" role="alert">{localizeMessage(state.error, locale)}</p>}
    {state.ok && <p className="text-sm font-semibold text-emerald-800" role="status">{state.message ? localizeMessage(state.message, locale) : t('تم الحفظ', 'Saved')}</p>}
    <button type="submit" className={`btn min-h-12 w-full sm:w-auto ${courier && !allowed.length ? 'btn-danger' : 'btn-primary'}`} disabled={pending || (!courier && !allowed.length)}><Check size={18} />{pending ? t('جاري الحفظ…', 'Saving…') : courier ? t('حفظ المطاعم المسموحة', 'Save restaurant access') : t('إنشاء حساب المندوب', 'Create courier account')}</button>
  </form>;
}
