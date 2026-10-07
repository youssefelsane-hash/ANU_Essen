import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { looksLikeImage } from '@/server/images';
import { applyOrderAction, expireUnpaidOrder } from '@/server/services/order-actions';
import { MAX_SCREENSHOT_BYTES, submitPaymentSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Customer pressed "تم التحويل": InstaPay transfer reported (reference + screenshot are optional). */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }, meta) => {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  await enforceRateLimit(`payment:${token}`, 10, 600);
  const input = submitPaymentSchema.parse(await readJson(req, 800_000));
  const [order] = await db().select({ id: orders.id }).from(orders).where(eq(orders.trackingToken, token));
  if (!order) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  if (await expireUnpaidOrder(order.id)) throw new AppError('CONFLICT', 'انتهت مهلة الدفع، ابدأ طلبًا جديدًا');

  let attachment: { contentType: string; data: Buffer } | null = null;
  if (input.screenshot) {
    const data = Buffer.from(input.screenshot.base64, 'base64');
    if (data.length > MAX_SCREENSHOT_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'الصورة كبيرة');
    if (!looksLikeImage(data, input.screenshot.contentType)) throw new AppError('VALIDATION', 'الملف ليس صورة صالحة');
    attachment = { contentType: input.screenshot.contentType, data };
  }

  const result = await applyOrderAction({
    orderId: order.id,
    action: 'SUBMIT_PAYMENT',
    actor: { type: 'CUSTOMER', label: 'customer', ip: meta.ip, userAgent: meta.userAgent },
    payload: { reference: input.reference ?? null },
    attachment,
  });
  return json({ status: result.status });
});
