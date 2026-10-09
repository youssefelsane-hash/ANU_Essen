'use client';

import Link from 'next/link';
import { useLanguage } from '@/components/language-provider';

/**
 * Friendly error screen. On Vercel Preview copies (built without a database on purpose, so they
 * never touch production data) it says so and links to the live site instead of a bare error.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLanguage();
  const isPreview = process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview';
  const production = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl" aria-hidden="true">{isPreview ? '🧪' : '⚠️'}</div>
      {isPreview ? (
        <>
          <h1 className="text-xl font-bold">{t('دي نسخة تجريبية (Preview) من غير قاعدة بيانات', 'This is a Preview copy without a database')}</h1>
          <p className="text-sm leading-7 text-gray-600">{t('نسخ الـ Preview مش متوصلة ببيانات الموقع الحقيقي عشان تفضل في أمان. الموقع الحقيقي شغال على الرابط ده:', 'Preview copies are kept away from live data for safety. The live site is here:')}</p>
          {production && <a className="btn btn-primary" href={`https://${production}`} dir="ltr">{production}</a>}
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold">{t('حصلت مشكلة مؤقتة', 'Something went wrong')}</h1>
          <p className="text-sm text-gray-600">{t('جرّب تاني بعد لحظة. لو المشكلة استمرت كلّم المطعم.', 'Please try again in a moment. If it keeps happening, contact the restaurant.')}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => reset()}>{t('حاول تاني', 'Try again')}</button>
            <Link href="/" className="btn btn-secondary">{t('الرئيسية', 'Home')}</Link>
          </div>
        </>
      )}
    </main>
  );
}
