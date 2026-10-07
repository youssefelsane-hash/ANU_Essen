import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import { media } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

/** Public menu photos. Content never changes for an id, so browsers and the CDN may cache it for a year. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response('Not found', { status: 404 });
  const [row] = await db().select({ contentType: media.contentType, data: media.data }).from(media).where(eq(media.id, id));
  if (!row) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      'content-type': row.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
