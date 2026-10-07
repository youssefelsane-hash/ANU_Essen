import { cookies, headers } from 'next/headers';
import { LANGUAGE_COOKIES, resolveLocale, type LanguageScope } from './index';

export async function getLanguageScope(): Promise<LanguageScope> {
  return (await headers()).get('x-app-language-scope') === 'staff' ? 'staff' : 'customer';
}

export async function getLocale(scope?: LanguageScope) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const area = scope ?? (headerStore.get('x-app-language-scope') === 'staff' ? 'staff' : 'customer');
  return resolveLocale(area, cookieStore.get(LANGUAGE_COOKIES[area])?.value, headerStore.get('accept-language'));
}
