'use client';

import type { ReactNode } from 'react';
import { logoutAction } from '@/server/actions/auth';

/** Clear the cached authenticated HTML before another person uses this terminal. Keep pending orders intact. */
export function SafeSignOutForm({ children, className }: { children: ReactNode; className?: string }) {
  return <form className={className} action={async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('merchant-pages-')).map((key) => caches.delete(key)));
    }
    await logoutAction();
  }}>{children}</form>;
}
