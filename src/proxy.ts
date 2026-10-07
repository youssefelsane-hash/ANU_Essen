import { NextResponse, type NextRequest } from 'next/server';
import { languageScope } from './lib/i18n';

/** Set scope on the forwarded request; no locale redirects, database calls or extra page hops. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-app-language-scope', languageScope(request.nextUrl.pathname));
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|icons/|images/).*)'] };
