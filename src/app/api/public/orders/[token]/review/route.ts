import { z } from 'zod';
import { AppError } from '@/server/errors';
import { json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { submitReview } from '@/server/services/reviews';

export const dynamic = 'force-dynamic';

const stars = z.number().int().min(1).max(5);
const reviewSchema = z.object({
  rating: stars,
  comment: z.string().trim().max(500).optional().nullable(),
  items: z.array(z.object({ productId: z.uuid(), rating: stars })).max(30).optional(),
});

/** Customer rates a delivered order (once). */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }, meta) => {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  await enforceRateLimit(`review:${token}`, 5, 3600);
  await enforceRateLimit(`review:ip:${meta.ip ?? 'unknown'}`, 30, 3600);
  const input = reviewSchema.parse(await readJson(req, 8_000));
  const result = await submitReview({ token, ...input, ip: meta.ip, userAgent: meta.userAgent });
  return json(result, { status: 201 });
});
