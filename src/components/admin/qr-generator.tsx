'use client';

import { useEffect, useState } from 'react';

/** QR codes for campus posters, with optional utm_source per poster. */
export function QrGenerator({ slug, baseUrl }: { slug: string; baseUrl: string | null }) {
  const [source, setSource] = useState('campus_poster_1');
  const [origin, setOrigin] = useState(baseUrl ?? '');
  const [svg, setSvg] = useState('');
  useEffect(() => {
    if (!baseUrl) setOrigin(window.location.origin);
  }, [baseUrl]);
  const url = `${origin.replace(/\/$/, '')}/s/${slug}${source.trim() ? `?utm_source=${encodeURIComponent(source.trim())}` : ''}`;

  useEffect(() => {
    let cancelled = false;
    import('qrcode').then((QR) =>
      QR.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }).then((s) => {
        if (!cancelled) setSvg(s);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const download = (href: string, filename: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
  };

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_240px]">
      <div className="space-y-3">
        <div>
          <label className="label">Public base URL</label>
          <input className="input" value={origin} onChange={(e) => setOrigin(e.target.value)} dir="ltr" />
        </div>
        <div>
          <label className="label">utm_source (which poster)</label>
          <input className="input" value={source} onChange={(e) => setSource(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} dir="ltr" />
        </div>
        <p className="break-all rounded-lg bg-gray-50 p-2 font-mono text-xs" dir="ltr">{url}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={async () => {
              const QR = await import('qrcode');
              download(await QR.toDataURL(url, { width: 1200, margin: 2, errorCorrectionLevel: 'M' }), `qr-${slug}-${source || 'direct'}.png`);
            }}
          >
            Download PNG
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!svg} onClick={() => download(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), `qr-${slug}-${source || 'direct'}.svg`)}>
            Download SVG
          </button>
        </div>
      </div>
      <div className="rounded-xl bg-white p-2 ring-1 ring-gray-200" aria-label="QR preview">
        {svg ? <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt={`QR code for ${url}`} className="w-full" /> : <div className="skeleton aspect-square" />}
      </div>
    </div>
  );
}
