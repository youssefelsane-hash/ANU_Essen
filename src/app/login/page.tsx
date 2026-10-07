import type { Metadata } from 'next';
import { safeInternalPath } from '@/lib/domain/misc';
import { redirect } from 'next/navigation';
import { getAuth } from '@/server/auth/session';
import { loginAction } from '@/server/actions/auth';
import { ActionForm, SubmitButton } from '@/components/forms';
import Link from 'next/link';
import { UtensilsCrossed, ArrowLeft, ShieldCheck } from 'lucide-react';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/language-switcher';

export async function generateMetadata(): Promise<Metadata> { return { title: text(await getLocale('staff'), 'دخول فريق العمل', 'Team sign in'), robots: { index: false } }; }
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const locale = await getLocale('staff');
  const t = (ar: string, en: string) => text(locale, ar, en);
  const auth = await getAuth();
  if (auth) redirect(safeInternalPath(next) ?? (auth.isPlatform ? '/admin' : '/merchant'));
  return (
    <main className="login-shell">
      <section className="login-intro">
        <UtensilsCrossed size={34} strokeWidth={1.3} className="mb-12 text-amber-200" />
        <p className="mb-4 text-xs tracking-widest text-amber-200">{t('إدارة يومك بسهولة', 'Make every day easier')}</p>
        <h1 className="text-4xl font-semibold leading-relaxed md:text-5xl">{t('كل طلب، في مكانه الصحيح.', 'Every order, in the right place.')}</h1>
        <p className="mt-5 max-w-sm text-sm leading-8 text-stone-300">{t('تابع الطلبات، جهّزها، وسلّمها. كل اللي يحتاجه فريقك في مكان واحد.', 'See orders, prepare them and hand them over. Everything your team needs in one place.')}</p>
      </section>
      <section className="login-panel"><div className="login-panel-inner">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3"><Link href="/" className="flex items-center gap-2 text-xs text-gray-500">{t('العودة للمطاعم', 'Back to restaurants')} <ArrowLeft size={15} /></Link><LanguageSwitcher /></div>
      <h2 className="mb-2 text-3xl font-semibold">{t('أهلًا بعودتك', 'Welcome back')}</h2>
      <p className="mb-8 text-sm text-gray-500">{t('سجّل دخولك لإدارة المطعم أو المنصة.', 'Sign in to manage your restaurant or the platform.')}</p>
      <ActionForm action={loginAction} className="space-y-5">
        <input type="hidden" name="next" value={next ?? ''} />
        <div>
          <label className="label" htmlFor="email">{t('البريد الإلكتروني', 'Email address')}</label>
          <input id="email" name="email" type="email" autoComplete="username" required className="input" dir="ltr" placeholder="name@restaurant.com" />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('كلمة المرور', 'Password')}</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" dir="ltr" />
        </div>
        <SubmitButton className="btn btn-primary btn-lg w-full">{t('تسجيل الدخول', 'Sign in')} <ArrowLeft size={18} /></SubmitButton>
      </ActionForm>
      <p className="mt-8 flex items-center justify-center gap-2 text-xs text-gray-400"><ShieldCheck size={15} />{t('دخول آمن لفريق العمل فقط', 'Secure access for team members only')}</p>
      </div></section>
    </main>
  );
}
