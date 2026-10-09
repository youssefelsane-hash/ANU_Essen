import { z } from 'zod';
import { json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { createTicket, TICKET_CATEGORIES } from '@/server/services/support';

export const dynamic = 'force-dynamic';

const ticketSchema = z.object({
  orderToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional().nullable(),
  category: z.enum(TICKET_CATEGORIES),
  message: z.string().trim().min(5).max(2000),
  customerName: z.string().trim().max(60).optional().nullable(),
  customerPhone: z.string().trim().max(20).optional().nullable(),
});

/** Customer opens a complaint / question (no account; the returned token is their link). */
export const POST = route(async (req, _ctx, meta) => {
  await enforceRateLimit(`support:ip:${meta.ip ?? 'unknown'}`, 10, 3600);
  const input = ticketSchema.parse(await readJson(req, 8_000));
  const created = await createTicket({ ...input, ip: meta.ip, userAgent: meta.userAgent });
  return json(created, { status: 201 });
});
