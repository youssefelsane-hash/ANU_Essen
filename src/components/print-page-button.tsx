'use client';

import { Printer } from 'lucide-react';
import { useLanguage } from './language-provider';

export function PrintPageButton() {
  const { t } = useLanguage();
  return <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}><Printer size={15} />{t('طباعة', 'Print')}</button>;
}
