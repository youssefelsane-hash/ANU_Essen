'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { localizeMessage } from '@/lib/i18n';

const MAX_SIDE = 1200;

/** Resize + re-encode in the browser so phone photos (often 3–8 MB) upload in a second. */
async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await encode('image/webp', 0.8);
  if (webp && webp.type === 'image/webp') return webp;
  return (await encode('image/jpeg', 0.82))!;
}

/** Photo picker that uploads to the restaurant's media store and submits the resulting URL as `name`. */
export function ImageField({ name, restaurantId, initial, label }: { name: string; restaurantId: string; initial: string | null; label: string }) {
  const { t, locale } = useLanguage();
  const [url, setUrl] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const blob = await compress(file);
      const res = await fetch(`/api/merchant/media?restaurantId=${encodeURIComponent(restaurantId)}`, { method: 'POST', headers: { 'content-type': blob.type }, body: blob, signal: AbortSignal.timeout(30000) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) setError(data?.error?.message || t('تعذّر رفع الصورة. جرّب تاني.', "We couldn't upload the photo. Try again."));
      else setUrl(data.url);
    } catch {
      setError(t('مش قادرين نقرأ الصورة. جرّب صورة تانية.', "We couldn't read that image. Try another one."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={url} />
      <div className="flex items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-20 w-20 rounded-xl object-cover ring-1 ring-gray-200" />
        ) : (
          <div className="grid h-20 w-20 place-items-center rounded-xl bg-gray-100 text-gray-400"><ImagePlus size={26} /></div>
        )}
        <div className="flex flex-col gap-2">
          <label className={`btn btn-secondary btn-sm cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            <ImagePlus size={15} />{busy ? t('جاري الرفع…', 'Uploading…') : url ? t('تغيير الصورة', 'Change photo') : t('رفع صورة', 'Upload photo')}
            <input ref={input} type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
          </label>
          {url && <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => setUrl('')}><Trash2 size={14} />{t('شيل الصورة', 'Remove photo')}</button>}
        </div>
      </div>
      {error && <p className="text-xs text-red-700" role="alert">{localizeMessage(error, locale)}</p>}
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">{t('أو حط رابط صورة', 'Or paste an image link')}</summary>
        <input className="input mt-1" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://…" aria-label={t('رابط الصورة', 'Image link')} />
      </details>
    </div>
  );
}
