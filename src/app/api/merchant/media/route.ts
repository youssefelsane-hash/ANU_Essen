import { z } from 'zod';
import { requireAuth } from '@/server/auth/session';
import { db } from '@/server/db';
import { media } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { assertSameOrigin, json, route } from '@/server/http';
import { isImageType, looksLikeImage, MAX_MEDIA_BYTES } from '@/server/images';
import { enforceRateLimit } from '@/server/rate-limit';
import { audit } from '@/server/services/audit';
import { hasPermission } from '@/lib/domain/permissions';

export const dynamic = 'force-dynamic';

/** Upload a restaurant-owned photo; profile editors do not receive menu-editing permissions. */
export const POST = route(async (req, _ctx, meta) => {
  assertSameOrigin(req);
  const auth = await requireAuth();
  const query = new URL(req.url).searchParams;
  const restaurantId = z.uuid().parse(query.get('restaurantId'));
  const scope = z.enum(['menu', 'profile']).parse(query.get('scope') ?? 'menu');
  const permission = scope === 'profile' ? 'store.profile' : 'menu.manage';
  if (!hasPermission(auth, permission, restaurantId)) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء');
  await enforceRateLimit(`media:${auth.user.id}`, 60, 3600);
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!isImageType(contentType)) throw new AppError('VALIDATION', 'الملف ليس صورة صالحة');
  if (Number(req.headers.get('content-length') ?? 0) > MAX_MEDIA_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'الصورة كبيرة');
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length > MAX_MEDIA_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'الصورة كبيرة');
  if (!data.length || !looksLikeImage(data, contentType)) throw new AppError('VALIDATION', 'الملف ليس صورة صالحة');
  const [row] = await db().insert(media).values({ restaurantId, contentType, sizeBytes: data.length, data, createdByUserId: auth.user.id }).returning({ id: media.id });
  await audit({ actor: { type: 'USER', userId: auth.user.id, label: auth.user.name }, action: 'media.uploaded', entity: 'media', entityId: row.id, restaurantId, after: { contentType, sizeBytes: data.length }, ip: meta.ip, userAgent: meta.userAgent });
  return json({ id: row.id, url: `/media/${row.id}` }, { status: 201 });
});
