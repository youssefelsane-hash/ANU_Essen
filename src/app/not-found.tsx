import Link from 'next/link';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/language-switcher';

export default async function NotFound() {
  const locale = await getLocale();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl">🔎</div>
      <h1 className="text-xl font-bold">{text(locale, 'الصفحة دي مش موجودة', 'This page was not found')}</h1>
      <Link href="/" className="btn btn-primary">{text(locale, 'الرئيسية', 'Home')}</Link>
      <LanguageSwitcher />
    </main>
  );
}
