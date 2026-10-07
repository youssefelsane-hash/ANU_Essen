import type { Metadata, Viewport } from 'next';
import './globals.css';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
