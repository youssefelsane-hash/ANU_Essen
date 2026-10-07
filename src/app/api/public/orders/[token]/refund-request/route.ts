import { z } from 'zod';
import { AppError } from '@/server/errors';
import { json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { requestRefundByCustomer } from '@/server/services/refunds';

export const dynamic = 'force-dynamic';

const refundRequestSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  payoutDetails: z.string().trim().max(120).optional().nullable(),
});

/** Customer asks the restaurant for their money back (finished, paid orders; reviewed by staff). */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }, meta) => {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  await enforceRateLimit(`refund-request:${token}`, 5, 3600);
  await enforceRateLimit(`refund-request:ip:${meta.ip ?? 'unknown'}`, 20, 3600);
  const input = refundRequestSchema.parse(await readJson(req, 4_000));
  const result = await requestRefundByCustomer({ token, reason: input.reason, payoutDetails: input.payoutDetails, ip: meta.ip, userAgent: meta.userAgent });
  return json(result, { status: 201 });
});
