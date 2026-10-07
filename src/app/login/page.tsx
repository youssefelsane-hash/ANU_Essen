import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuth } from '@/server/auth/session';
import { loginAction } from '@/server/actions/auth';
import { ActionForm, SubmitButton } from '@/components/forms';

export const metadata: Metadata = { title: 'Staff sign in', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const auth = await getAuth();
  if (auth) redirect(next?.startsWith('/') && !next.startsWith('//') ? next : auth.isPlatform ? '/admin' : '/merchant');
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6" dir="ltr">
      <h1 className="mb-1 text-2xl font-extrabold">Staff sign in</h1>
      <p className="mb-6 text-sm text-gray-500">Restaurant staff &amp; platform admins · تسجيل دخول الموظفين</p>
      <ActionForm action={loginAction} className="card space-y-4">
        <input type="hidden" name="next" value={next ?? ''} />
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        <SubmitButton className="btn btn-primary w-full">Sign in</SubmitButton>
      </ActionForm>
    </main>
  );
}
