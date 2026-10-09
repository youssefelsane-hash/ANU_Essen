import { json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { quote, toCustomerQuote } from '@/server/services/checkout';
import { quoteSchema } from '@/lib/validation';
import { env } from '@/server/env';

export const dynamic = 'force-dynamic';

export const POST = route<{ params: Promise<{ slug: string }> }>(async (req, { params }, meta) => {
  const { slug } = await params;
  await enforceRateLimit(`quote:${meta.ip ?? 'unknown'}`, env().QUOTE_IP_RATE_LIMIT, 60);
  const input = quoteSchema.parse(await readJson(req, 50_000));
  return json(toCustomerQuote(await quote(slug, input)));
});
