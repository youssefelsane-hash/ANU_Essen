import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { json, route } from '@/server/http';
import { loadPublicMenu } from '@/server/services/menu';

export const dynamic = 'force-dynamic';

export const GET = route<{ params: Promise<{ slug: string }> }>(async (_req, { params }) => {
  const { slug } = await params;
  const menu = await loadPublicMenu(db(), slug);
  if (!menu) throw new AppError('NOT_FOUND', 'المحل غير موجود');
  return json({ serverTime: Date.now(), ...menu });
});
