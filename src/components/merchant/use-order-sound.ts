'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Browser audio needs one explicit gesture in each newly opened screen. */
export function useOrderSound() {
  const context = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [failed, setFailed] = useState(false);
  const play = useCallback(() => {
    const ctx = context.current;
    if (!ctx || ctx.state !== 'running') return;
    [0, .25, .5, 1].forEach((offset, index) => {
      const oscillator = ctx.createOscillator(), volume = ctx.createGain(), start = ctx.currentTime + offset;
      oscillator.frequency.value = index % 2 ? 1320 : 990;
      volume.gain.setValueAtTime(.0001, start);
      volume.gain.exponentialRampToValueAtTime(.25, start + .025);
      volume.gain.exponentialRampToValueAtTime(.0001, start + .23);
      oscillator.connect(volume).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + .25);
    });
  }, []);
  const toggle = useCallback(async () => {
    setFailed(false);
    try {
      context.current ??= new AudioContext();
      const ctx = context.current;
      ctx.onstatechange = () => setEnabled(ctx.state === 'running');
      if (ctx.state === 'running') await ctx.suspend();
      else { await ctx.resume(); play(); }
      setEnabled(ctx.state === 'running');
      try { localStorage.setItem('merchant:sound-enabled', ctx.state === 'running' ? '1' : '0'); } catch { /* Private browsing. */ }
    } catch { setFailed(true); setEnabled(false); }
  }, [play]);
  useEffect(() => () => { const ctx = context.current; if (ctx) { ctx.onstatechange = null; void ctx.close().catch(() => {}); } }, []);
  return { enabled, failed, play, toggle };
}
