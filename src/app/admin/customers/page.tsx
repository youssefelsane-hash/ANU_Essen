import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { desc, ilike, or } from 'drizzle-orm';
import { db } from '@/server/db';
import { customers } from '@/server/db/schema';
import { platformTimezone } from '@/server/admin-guard';
import { Forbidden, PageTitle, Pagination } from '@/components/admin/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { updateCustomerFlagsAction } from '@/server/actions/customers';
import { can } from '@/server/auth/authz';
import { pageAuth } from '@/server/auth/session';
import { formatDateTime } from '@/lib/domain/misc';

export const dynamic = 'force-dynamic';
const PAGE = 50;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const auth = await pageAuth('/admin/customers');
  if (!can(auth, 'platform.restaurants') && !can(auth, 'platform.support')) return <Forbidden />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const tz = await platformTimezone();
  const q = sp.q?.trim().slice(0, 40);
  const list = await db()
    .select()
    .from(customers)
    .where(q ? or(ilike(customers.phone, `%${q}%`), ilike(customers.name, `%${q}%`)) : undefined)
    .orderBy(desc(customers.lastOrderAt))
    .limit(PAGE + 1)
    .offset((page - 1) * PAGE);
  return (
    <div>
      <PageTitle title={t("العملاء", "Customers")} subtitle={t("الطلب متاح دون حساب. رقم الهاتف يربط طلبات العميل. «ما استلمش» = طلبات جهزت والعميل ما جاش؛ لما توصل للحد اللي في الإعدادات، الرقم ده بيدفع إنستاباي بس.", "Guest checkout — customers are identified by phone. “No-shows” are ready orders nobody collected; at the limit set in Settings the number must pay by InstaPay.")} />
      <form className="mb-4 flex gap-2"><input aria-label={t("بحث", "Search")} name="q" defaultValue={q ?? ''} placeholder={t("رقم الهاتف أو الاسم", "Phone or name")} className="input max-w-xs" /><button className="btn btn-secondary">{t("بحث", "Search")}</button></form>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>{t("الاسم", "Name")}</th><th>{t("الهاتف", "Phone")}</th><th>{t("الطلبات", "Orders")}</th><th>{t("ما استلمش", "No-shows")}</th><th>{t("آخر طلب", "Last order")}</th><th>{t("الحالة", "Status")}</th></tr></thead>
          <tbody>
            {list.slice(0, PAGE).map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td className="font-mono" dir="ltr">{c.phone}</td><td>{c.ordersCount}</td>
                <td>{c.noShowCount > 0 ? <span className="badge bg-amber-100 text-amber-800">{c.noShowCount}</span> : '—'}</td>
                <td className="text-xs">{c.lastOrderAt ? formatDateTime(c.lastOrderAt, tz, locale) : '—'}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-1">
                    {c.isBlocked && <span className="badge bg-red-100 text-red-700" title={c.blockedReason ?? ''}>{t('موقوف', 'Blocked')}</span>}
                    <ActionForm action={updateCustomerFlagsAction} confirm={c.isBlocked ? undefined : t('إيقاف الرقم ده من الطلب أونلاين؟', 'Block this number from online ordering?')}>
                      <input type="hidden" name="customerId" value={c.id} />
                      <input type="hidden" name="op" value={c.isBlocked ? 'unblock' : 'block'} />
                      <SubmitButton className={`btn btn-sm ${c.isBlocked ? 'btn-secondary' : 'btn-ghost text-red-700'}`}>{c.isBlocked ? t('إلغاء الإيقاف', 'Unblock') : t('إيقاف', 'Block')}</SubmitButton>
                    </ActionForm>
                    {c.noShowCount > 0 && (
                      <ActionForm action={updateCustomerFlagsAction}>
                        <input type="hidden" name="customerId" value={c.id} />
                        <input type="hidden" name="op" value="reset_no_shows" />
                        <SubmitButton className="btn btn-ghost btn-sm">{t('تصفير «ما استلمش»', 'Reset no-shows')}</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} hasMore={list.length > PAGE} base={`/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`} />
      </section>
    </div>
  );
}
