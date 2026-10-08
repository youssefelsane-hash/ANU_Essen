import { text, type Locale } from './i18n';

/** The counter's built-in placeholder is invariant for safe retries, with localized display. */
export function customerLabel(name: string, locale: Locale): string {
  return name === 'عميل المحل' ? text(locale, 'عميل المحل', 'Walk-in customer') : name;
}
