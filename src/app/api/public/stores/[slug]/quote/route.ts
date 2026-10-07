import { json, readJson, route } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { quote } from '@/server/services/checkout';
import { quoteSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const POST = route<{ params: Promise<{ slug: string }> }>(async (req, { params }, meta) => {
  const { slug } = await params;
  await enforceRateLimit(`quote:${meta.ip ?? 'unknown'}`, 240, 60);
  const input = quoteSchema.parse(await readJson(req, 50_000));
  return json(await quote(slug, input));
});
