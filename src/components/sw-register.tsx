'use client';
import { useEffect } from 'react';

/** Registers the merchant service worker (app shell cache) so the PWA reopens without internet. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js', { scope: '/merchant' }).catch(() => {});
  }, []);
  return null;
}
