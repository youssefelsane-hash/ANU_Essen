'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { useLanguage } from './language-provider';
import { localizeMessage } from '@/lib/i18n';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const { locale } = useLanguage();
  const [state, formAction] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state.error && <p className="mt-2 text-sm font-medium text-red-600" role="alert">{localizeMessage(state.error, locale)}</p>}
      {state.ok && state.message && <p className="mt-2 text-sm font-medium text-green-700" role="status">{localizeMessage(state.message, locale)}</p>}
    </form>
  );
}

export function SubmitButton({ children, className = 'btn btn-primary' }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  const { t } = useLanguage();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? t('جاري الحفظ…', 'Saving…') : children}
    </button>
  );
}
