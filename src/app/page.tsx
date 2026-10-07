import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { restaurants } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const list = await db()
    .select({ slug: restaurants.slug, nameAr: restaurants.nameAr, nameEn: restaurants.nameEn, logoUrl: restaurants.logoUrl })
    .from(restaurants)
    .where(eq(restaurants.isActive, true))
    .orderBy(asc(restaurants.nameAr));
  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="mb-1 text-2xl font-extrabold">اطلب أكلك 🍽️</h1>
      <p className="mb-5 text-sm text-gray-600">اختار المحل، اطلب، واستلم عند بوابة الجامعة.</p>
      <div className="space-y-3">
        {list.map((r) => (
          <Link key={r.slug} href={`/s/${r.slug}`} className="card flex items-center gap-3 hover:ring-orange-300">
            <div className="grid size-12 place-items-center rounded-xl bg-orange-100 text-xl font-bold text-orange-700">{r.nameAr.slice(0, 1)}</div>
            <div>
              <div className="font-bold">{r.nameAr}</div>
              <div className="text-xs text-gray-500" dir="ltr">{r.nameEn}</div>
            </div>
          </Link>
        ))}
        {list.length === 0 && <p className="text-gray-500">لا توجد محلات متاحة حاليًا.</p>}
      </div>
      <div className="mt-10 text-center text-xs text-gray-400">
        <Link href="/login">دخول الموظفين</Link>
      </div>
    </main>
  );
}
