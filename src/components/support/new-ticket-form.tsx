'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/language-provider';
import { rememberTicket } from '@/client/storage';
import { customerMessage } from '@/components/customer/messages';
import { TICKET_CATEGORY_LABELS } from '@/lib/domain/support-labels';

/** Customer opens a complaint. From an order page the order is attached and name/phone come from it. */
export function NewTicketForm({ orderToken, orderNumber }: { orderToken: string | null; orderNumber: string | null }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [category, setCategory] = useState(orderToken ? 'ORDER' : 'OTHER');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/public/support', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ orderToken, category, message, customerName: name || null, customerPhone: phone || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.token) {
        setError(data?.error?.message || t('تعذّر الإرسال. جرّب تاني.', "We couldn't send it. Please try again."));
        setBusy(false);
        return;
      }
      rememberTicket({ token: data.token, code: data.code, createdAt: Date.now() });
      router.push(`/support/${data.token}`);
    } catch {
      setError(t('النت ضعيف — حاول تاني', 'The connection is unstable. Please try again.'));
      setBusy(false);
    }
  }

  const options = orderToken ? ['ORDER', 'FOOD', 'DELIVERY', 'PAYMENT', 'OTHER'] : ['APP', 'SUGGESTION', 'PAYMENT', 'OTHER'];
  return (
    <form onSubmit={submit} className="card space-y-4">
      {orderNumber && <p className="rounded-xl bg-stone-50 p-3 text-sm">{t('بخصوص طلب ', 'About order ')}<b dir="ltr">#{orderNumber}</b></p>}
      <fieldset className="space-y-2">
        <legend className="label">{t('نوع المشكلة', 'What is it about?')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((c) => (
            <label key={c} className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${category === c ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
              <input type="radio" name="category" value={c} checked={category === c} onChange={() => setCategory(c)} />
              {t(...TICKET_CATEGORY_LABELS[c])}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="label">{t('احكيلنا اللي حصل', 'Tell us what happened')}</span>
        <textarea className="input" rows={5} required minLength={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('مثلاً: الطلب وصل من غير المشروب', 'e.g. the drink was missing from my order')} />
      </label>
      {!orderToken && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">{t('اسمك', 'Your name')}</span><input className="input" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label className="block"><span className="label">{t('رقم موبايلك (عشان نرد عليك)', 'Your mobile (so we can reply)')}</span><input className="input" required inputMode="tel" dir="ltr" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" /></label>
        </div>
      )}
      <button className="btn btn-primary w-full" disabled={busy || message.trim().length < 5}>{busy ? t('جاري الإرسال…', 'Sending…') : t('إرسال', 'Send')}</button>
      {error && <p className="text-sm text-red-700" role="alert">{customerMessage(error, locale)}</p>}
      <p className="text-xs text-stone-500">{t('هتاخد رابط تتابع منه الرد. الرابط بيتحفظ على موبايلك في «طلباتي».', 'You will get a link to follow the reply; it is saved on this phone under “My orders”.')}</p>
    </form>
  );
}

/** Customer writes back on their ticket. */
export function TicketReplyForm({ token }: { token: string }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/public/support/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }), signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message || t('تعذّر الإرسال. جرّب تاني.', "We couldn't send it. Please try again."));
      } else {
        setBody('');
        router.refresh();
      }
    } catch { setError(t('النت ضعيف — حاول تاني', 'The connection is unstable. Please try again.')); }
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea className="input" rows={3} required minLength={2} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('اكتب رسالتك…', 'Write your message…')} aria-label={t('رسالتك', 'Your message')} />
      <button className="btn btn-primary" disabled={busy || body.trim().length < 2}>{busy ? t('جاري الإرسال…', 'Sending…') : t('إرسال', 'Send')}</button>
      {error && <p className="text-sm text-red-700" role="alert">{customerMessage(error, locale)}</p>}
    </form>
  );
}
