import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuth } from '@/server/auth/session';
import { loginAction } from '@/server/actions/auth';
import { ActionForm, SubmitButton } from '@/components/forms';
import Link from 'next/link';
import { UtensilsCrossed, ArrowLeft, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = { title: 'دخول فريق العمل', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const auth = await getAuth();
  if (auth) redirect(next?.startsWith('/') && !next.startsWith('//') ? next : auth.isPlatform ? '/admin' : '/merchant');
  return (
    <main className="login-shell">
      <section className="login-intro">
        <UtensilsCrossed size={34} strokeWidth={1.3} className="mb-12 text-amber-200" />
        <p className="mb-4 text-xs tracking-widest text-amber-200" dir="ltr">A BETTER WAY TO SERVE</p>
        <h1 className="text-4xl font-semibold leading-relaxed md:text-5xl">كل طلب،<br />في مكانه الصحيح.</h1>
        <p className="mt-5 max-w-sm text-sm leading-8 text-stone-300">من الطلب الأول لآخر استلام. مساحة واحدة لإدارة المطعم، ومتابعة فريقك، وتقديم تجربة أفضل لعملائك.</p>
      </section>
      <section className="login-panel"><div className="login-panel-inner">
      <Link href="/" className="mb-10 flex items-center gap-2 text-xs text-gray-500">العودة للمطاعم <ArrowLeft size={15} /></Link>
      <h2 className="mb-2 text-3xl font-semibold">أهلًا بعودتك</h2>
      <p className="mb-8 text-sm text-gray-500">سجّل دخولك لإدارة المطعم أو المنصة.</p>
      <ActionForm action={loginAction} className="space-y-5">
        <input type="hidden" name="next" value={next ?? ''} />
        <div>
          <label className="label" htmlFor="email">البريد الإلكتروني</label>
          <input id="email" name="email" type="email" autoComplete="username" required className="input" dir="ltr" placeholder="name@restaurant.com" />
        </div>
        <div>
          <label className="label" htmlFor="password">كلمة المرور</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" dir="ltr" />
        </div>
        <SubmitButton className="btn btn-primary btn-lg w-full">تسجيل الدخول <ArrowLeft size={18} /></SubmitButton>
      </ActionForm>
      <p className="mt-8 flex items-center justify-center gap-2 text-xs text-gray-400"><ShieldCheck size={15} />دخول آمن لفريق العمل فقط</p>
      </div></section>
    </main>
  );
}
