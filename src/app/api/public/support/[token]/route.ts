import { z } from 'zod';
import { AppError } from '@/server/errors';
import { json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { customerReply } from '@/server/services/support';

export const dynamic = 'force-dynamic';

/** Customer adds a message to their ticket. */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  await enforceRateLimit(`support:reply:${token}`, 30, 3600);
  const { body } = z.object({ body: z.string().trim().min(2).max(2000) }).parse(await readJson(req, 8_000));
  await customerReply(token, body);
  return json({ ok: true }, { status: 201 });
});
