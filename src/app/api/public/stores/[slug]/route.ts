import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { json, route } from '@/server/http';
import { loadPublicMenu } from '@/server/services/menu';
import { memo } from '@/server/cache';

export const dynamic = 'force-dynamic';

export const GET = route<{ params: Promise<{ slug: string }> }>(async (_req, { params }) => {
  const { slug } = await params;
  const menu = await memo(`menu:${slug.toLowerCase()}`, 5_000, () => loadPublicMenu(db(), slug));
  if (!menu) throw new AppError('NOT_FOUND', 'المحل غير موجود');
  // Same for every visitor: let the CDN absorb rush-hour refreshes for a few seconds.
  return json({ serverTime: Date.now(), ...menu }, { headers: { 'cache-control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=15' } });
});
