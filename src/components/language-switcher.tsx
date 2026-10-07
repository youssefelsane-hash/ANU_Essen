'use client';

import { Languages } from 'lucide-react';
import { useLanguage } from './language-provider';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, changeLanguage, t } = useLanguage();
  return <div className={`language-switcher ${className}`} role="group" aria-label={t('لغة العرض', 'Display language')}>
    <Languages size={16} aria-hidden="true" />
    <button type="button" lang="ar" aria-pressed={locale === 'ar'} onClick={() => changeLanguage('ar')}>العربية</button>
    <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => changeLanguage('en')}>English</button>
  </div>;
}
