import { getLocale } from '@/lib/i18n/server';
import { direction, isLocale, text } from '@/lib/i18n';

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get('lang');
  const locale = isLocale(requested) ? requested : await getLocale('staff');
  return Response.json({
    id: '/merchant',
    name: text(locale, 'إدارة المطعم — الطلبات', 'Restaurant workspace — Orders'),
    short_name: text(locale, 'الطلبات', 'Orders'),
    start_url: '/merchant',
    scope: '/merchant',
    display: 'standalone',
    orientation: 'any',
    background_color: '#172c22',
    theme_color: '#172c22',
    lang: locale,
    dir: direction(locale),
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'private, no-cache' } });
}
