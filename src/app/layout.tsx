import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getLocale, getLanguageScope } from '@/lib/i18n/server';
import { direction } from '@/lib/i18n';
import { LanguageProvider } from '@/components/language-provider';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
  title: { default: 'اطلب', template: '%s' },
  description: 'اختار أكلك، اعرف وقت الاستلام، وتابع طلبك خطوة بخطوة.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#172c22',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, scope] = await Promise.all([getLocale(), getLanguageScope()]);
  return (
    <html lang={locale} dir={direction(locale)} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="min-h-dvh antialiased"><LanguageProvider initialLocale={locale} initialScope={scope}>{children}</LanguageProvider></body>
    </html>
  );
}
