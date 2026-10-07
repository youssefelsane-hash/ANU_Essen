import { notFound } from 'next/navigation';
import { z } from 'zod';
import { merchantContext } from '@/server/merchant-context';
import { can } from '@/server/auth/authz';
import { ProductEditor } from '@/components/menu/product-editor';

export const dynamic = 'force-dynamic';

export default async function MerchantProductPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const isNew = pid === 'new';
  if (!isNew && !z.uuid().safeParse(pid).success) notFound();
  const { auth, restaurant, permissions } = await merchantContext('/merchant/menu/manage');
  if (!restaurant || !permissions.has('menu.manage')) notFound();
  return (
    <main className="mx-auto max-w-3xl p-4">
      <ProductEditor restaurantId={restaurant.id} productId={isNew ? null : pid} basePath="/merchant/menu/manage" surface="merchant" canLoad={can(auth, 'platform.queue')} />
    </main>
  );
}
