'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { direction, languageScope, LANGUAGE_COOKIES, resolveLocale, text, type LanguageScope, type Locale } from '@/lib/i18n';

const LanguageContext = createContext({ locale: 'ar' as Locale, scope: 'customer' as LanguageScope, t: (ar: string, _en: string) => ar, changeLanguage: (_locale: Locale) => {} });

function preference(scope: LanguageScope) {
  return document.cookie.split('; ').find((cookie) => cookie.startsWith(`${LANGUAGE_COOKIES[scope]}=`))?.split('=')[1];
}

export function LanguageProvider({ initialLocale, initialScope, children }: { initialLocale: Locale; initialScope: LanguageScope; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const scope = languageScope(pathname || '/');
  const [locale, setLocale] = useState(initialLocale);
  useEffect(() => { setLocale(initialLocale); }, [initialLocale]);
  useEffect(() => {
    setLocale(resolveLocale(scope, preference(scope), scope === initialScope ? initialLocale : navigator.languages.join(',')));
  }, [scope, initialScope, initialLocale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction(locale);
  }, [locale]);
  function changeLanguage(next: Locale) {
    document.cookie = `${LANGUAGE_COOKIES[scope]}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    setLocale(next);
    router.refresh();
  }
  return <LanguageContext.Provider value={{ locale, scope, t: (ar, en) => text(locale, ar, en), changeLanguage }}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
