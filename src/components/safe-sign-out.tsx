'use client';

import type { ReactNode } from 'react';
import { logoutAction } from '@/server/actions/auth';

/** Clear the cached authenticated HTML before another person uses this terminal. Keep pending orders intact. */
export function SafeSignOutForm({ children, className }: { children: ReactNode; className?: string }) {
  return <form className={className} action={async () => {
    try {
      // Unresolved attempts retain their scoped key so signing back in cannot duplicate a sent order.
      const drafts = Object.keys(sessionStorage).filter((key) => key.startsWith('counter-draft:'));
      for (const key of drafts) sessionStorage.removeItem(key);
    } catch { /* Continue logging out when browser storage is unavailable. */ }
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith('merchant-pages-')).map((key) => caches.delete(key)));
      } catch { /* Browser cleanup errors must not prevent the server from revoking this session. */ }
    }
    await logoutAction();
  }}>{children}</form>;
}
