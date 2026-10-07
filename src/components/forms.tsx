'use client';

import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { useLanguage } from './language-provider';
import { localizeMessage } from '@/lib/i18n';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Pending state of the surrounding ActionForm (submitted manually, so useFormStatus can't see it). */
const PendingContext = createContext(false);

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  /** Like React's own behaviour after a successful submit; failed submits always keep what was typed. */
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const { locale } = useLanguage();
  const [state, formAction, pending] = useActionState(action, initialActionState);
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
        // Submit through the action ourselves: React's automatic form reset would otherwise wipe
        // everything the user typed whenever the server rejects one field.
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state.error && <p className="mt-2 text-sm font-medium text-red-600" role="alert">{localizeMessage(state.error, locale)}</p>}
      {state.ok && state.message && <p className="mt-2 text-sm font-medium text-green-700" role="status">{localizeMessage(state.message, locale)}</p>}
    </form>
  );
}

export function SubmitButton({ children, className = 'btn btn-primary' }: { children: React.ReactNode; className?: string }) {
  const { pending: nativePending } = useFormStatus();
  const pending = useContext(PendingContext) || nativePending;
  const { t } = useLanguage();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? t('جاري الحفظ…', 'Saving…') : children}
    </button>
  );
}
