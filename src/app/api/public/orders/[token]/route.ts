import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { json, route } from '@/server/http';
import { loadTrackingView } from '@/server/services/order-views';

export const dynamic = 'force-dynamic';

export const GET = route<{ params: Promise<{ token: string }> }>(async (_req, { params }) => {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  const view = await loadTrackingView(db(), token);
  if (!view) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  return json(view);
});
