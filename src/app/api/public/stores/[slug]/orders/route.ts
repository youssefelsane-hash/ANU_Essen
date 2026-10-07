import { AppError } from '@/server/errors';
import { json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { createOrder } from '@/server/services/checkout';
import { normalizeEgyptianPhone } from '@/lib/domain/misc';
import { createOrderSchema, idempotencyKeySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Guest checkout. Requires an Idempotency-Key header so double taps / retries create one order only. */
export const POST = route<{ params: Promise<{ slug: string }> }>(async (req, { params }, meta) => {
  const { slug } = await params;
  const key = idempotencyKeySchema.safeParse(req.headers.get('idempotency-key'));
  if (!key.success) throw new AppError('VALIDATION', 'Missing or invalid Idempotency-Key header');

  const input = createOrderSchema.parse(await readJson(req, 50_000));
  // Campus users often share a carrier NAT IP, so the IP limit is generous; the phone limit is tight.
  await enforceRateLimit(`order:ip:${meta.ip ?? 'unknown'}`, 60, 600);
  const phone = input.customerPhone ? normalizeEgyptianPhone(input.customerPhone) : null;
  if (phone) await enforceRateLimit(`order:phone:${phone}`, 8, 600);

  const created = await createOrder(slug, input, key.data);
  return json(created, { status: created.replayed ? 200 : 201 });
});
