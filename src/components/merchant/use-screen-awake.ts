'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ScreenLock { released: boolean; release: () => Promise<void>; addEventListener: (type: 'release', listener: () => void) => void; }
type WakeNavigator = Navigator & { wakeLock?: { request: (kind: 'screen') => Promise<ScreenLock> } };

/** Opt-in only; browsers release locks in the background, so restore the user's choice on return. */
export function useScreenAwake() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  const [wanted, setWanted] = useState(false);
  const [failed, setFailed] = useState(false);
  const desired = useRef(false);
  const sentinel = useRef<ScreenLock | null>(null);
  const generation = useRef(0);
  const acquiring = useRef(false);

  const acquire = useCallback(async () => {
    const wakeLock = (navigator as WakeNavigator).wakeLock;
    if (!wakeLock || !desired.current || document.visibilityState !== 'visible' || acquiring.current || (sentinel.current && !sentinel.current.released)) return;
    acquiring.current = true;
    const version = generation.current;
    try {
      const lock = await wakeLock.request('screen');
      if (!desired.current || version !== generation.current) { await lock.release(); return; }
      sentinel.current = lock;
      setActive(!lock.released);
      setFailed(false);
      lock.addEventListener('release', () => {
        if (sentinel.current === lock) { sentinel.current = null; setActive(false); }
      });
    } catch { if (desired.current && version === generation.current) { setActive(false); setFailed(true); } }
    finally { acquiring.current = false; }
  }, []);

  const stop = useCallback(() => {
    desired.current = false;
    generation.current++;
    setWanted(false);
    setActive(false);
    setFailed(false);
    const lock = sentinel.current;
    sentinel.current = null;
    void lock?.release().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (active) { stop(); return; }
    desired.current = true;
    setWanted(true);
    setFailed(false);
    void acquire();
  }, [active, acquire, stop]);

  useEffect(() => {
    setSupported(!!(navigator as WakeNavigator).wakeLock);
    const onVisible = () => { if (document.visibilityState === 'visible' && desired.current) void acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      desired.current = false;
      generation.current++;
      const lock = sentinel.current;
      sentinel.current = null;
      void lock?.release().catch(() => {});
    };
  }, [acquire]);

  return { supported, active, wanted, failed, toggle, stop };
}
