import Link from 'next/link';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export async function Forbidden() {
  const locale = await getLocale();
  return <div className="card text-center text-gray-600">{text(locale, 'ليس لديك صلاحية لعرض هذه الصفحة.', 'You do not have permission to view this page.')}</div>;
}

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="admin-page-title">{title}</h1>
        {subtitle && <p className="mt-2 max-w-3xl text-xs leading-relaxed text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card admin-stat">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

export async function RestaurantTabs({ id, active }: { id: string; active: string }) {
  const locale = await getLocale();
  const t = (ar: string, en: string) => text(locale, ar, en);
  const tabs = [
    ['settings', t('بيانات المطعم', 'Details'), `/admin/restaurants/${id}`],
    ['queue', t('وقت التحضير', 'Preparation time'), `/admin/restaurants/${id}/queue`],
    ['menu', t('المنيو', 'Menu'), `/admin/restaurants/${id}/menu`],
    ['marketing', t('رمز الطلب والعروض', 'QR & offers'), `/admin/restaurants/${id}/marketing`],
    ['staff', t('الفريق', 'Team'), `/admin/restaurants/${id}/staff`],
  ];
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
      {tabs.map(([key, label, href]) => (
        <Link key={key} href={href} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${active === key ? 'border-orange-600 text-orange-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
          {label}
        </Link>
      ))}
    </div>
  );
}

export async function Pagination({ page, hasMore, base }: { page: number; hasMore: boolean; base: string }) {
  const locale = await getLocale();
  const sep = base.includes('?') ? '&' : '?';
  return (
    <div className="mt-3 flex justify-between text-sm">
      {page > 1 ? <Link className="btn btn-secondary btn-sm" href={`${base}${sep}page=${page - 1}`}>{text(locale, 'الأحدث', 'Newer')}</Link> : <span />}
      {hasMore && <Link className="btn btn-secondary btn-sm" href={`${base}${sep}page=${page + 1}`}>{text(locale, 'الأقدم', 'Older')}</Link>}
    </div>
  );
}
