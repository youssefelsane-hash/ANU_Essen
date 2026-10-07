import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { getRestaurant } from '@/server/services/store';

export const dynamic = 'force-dynamic';

/** A printed QR survives restaurant renames and menu URL changes. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse('Restaurant not found', { status: 404 });
  const restaurant = await getRestaurant(db(), id);
  if (!restaurant) return new NextResponse('Restaurant not found', { status: 404 });
  const target = new URL(`/s/${encodeURIComponent(restaurant.slug)}`, request.url);
  const source = request.nextUrl.searchParams.get('utm_source');
  if (source && /^[a-zA-Z0-9_-]{1,64}$/.test(source)) target.searchParams.set('utm_source', source);
  const response = NextResponse.redirect(target, 307);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
