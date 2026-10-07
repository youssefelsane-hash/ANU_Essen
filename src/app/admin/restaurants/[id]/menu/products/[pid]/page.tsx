import { notFound } from 'next/navigation';
import { z } from 'zod';
import { adminPage } from '@/server/admin-guard';
import { can } from '@/server/auth/authz';
import { ProductEditor } from '@/components/menu/product-editor';
import { Forbidden } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function ProductEditPage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const isNew = pid === 'new';
  if (!z.uuid().safeParse(id).success || (!isNew && !z.uuid().safeParse(pid).success)) notFound();
  const auth = await adminPage(`/admin/restaurants/${id}/menu`, 'platform.restaurants');
  if (!auth) return <Forbidden />;
  return <ProductEditor restaurantId={id} productId={isNew ? null : pid} basePath={`/admin/restaurants/${id}/menu`} surface="admin" canLoad={can(auth, 'platform.queue')} />;
}
