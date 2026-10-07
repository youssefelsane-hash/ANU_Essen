'use client';

import { useFormStatus } from 'react-dom';
import { useLanguage } from '@/components/language-provider';

export function AvailabilityToggle({ on, action, label }: { on: boolean; action: () => Promise<void>; label: string }) {
  return <form action={action}><AvailabilityButton on={on} label={label} /></form>;
}

function AvailabilityButton({ on, label }: { on: boolean; label: string }) {
  const { t } = useLanguage();
  const { pending } = useFormStatus();
  return <button type="submit" className={`btn min-h-11 min-w-28 ${on ? 'btn-success' : 'btn-secondary'}`} role="switch" aria-checked={on} aria-label={`${label}: ${t('متاح للبيع', 'Available to order')}`} disabled={pending}>
    {pending ? t('جاري الحفظ…', 'Saving…') : on ? t('متاح ✓', 'Available ✓') : t('غير متاح', 'Unavailable')}
  </button>;
}
