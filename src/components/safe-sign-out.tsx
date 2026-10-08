'use client';

import type { ReactNode } from 'react';
import { logoutAction } from '@/server/actions/auth';

/** Clear the cached authenticated HTML before another person uses this terminal. Keep pending orders intact. */
export function SafeSignOutForm({ children, className }: { children: ReactNode; className?: string }) {
  return <form className={className} action={async () => {
    try {
      const counterKeys = Object.keys(sessionStorage).filter((key) => key.startsWith('counter-draft:') || key.startsWith('counter-attempt:'));
      for (const key of counterKeys) sessionStorage.removeItem(key);
    } catch { /* Session storage may be disabled on this device. */ }
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith('merchant-pages-')).map((key) => caches.delete(key)));
      } catch { /* A browser cleanup error must not prevent session revocation. */ }
    }
    await logoutAction();
  }}>{children}</form>;
}
