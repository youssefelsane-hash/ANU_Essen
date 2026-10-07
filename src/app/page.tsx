import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { ArrowLeft, UtensilsCrossed, ScanLine, Clock3, ShoppingBag } from 'lucide-react';
import { db } from '@/server/db';
import { restaurants } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const list = await db().select().from(restaurants).where(eq(restaurants.isActive, true)).orderBy(asc(restaurants.nameAr));
  return <main className="directory">
    <header className="directory-header">
      <Link href="/" className="flex items-center gap-3"><UtensilsCrossed size={24} strokeWidth={1.5} /><span className="text-lg font-semibold">اطلب</span></Link>
      <Link href="/login" className="text-xs text-gray-500">دخول فريق العمل <ArrowLeft size={13} className="ms-2 inline" /></Link>
    </header>
    <section className="directory-title">
      <span className="text-xs tracking-widest text-stone-500" dir="ltr">GOOD FOOD. LESS WAITING.</span>
      <h1>وقتك غالي.<br />خلي أكلك يوصل لك.</h1>
      <p className="text-sm leading-7 text-stone-500">اختار مطعمك، اعرف وقت الاستلام، وتابع طلبك من مكانك.</p>
      <div className="mt-6 flex flex-wrap gap-6 text-xs text-stone-500">
        <span className="flex items-center gap-2"><ScanLine size={16} />افتح المنيو</span>
        <span className="flex items-center gap-2"><ShoppingBag size={16} />اختار أكلك</span>
        <span className="flex items-center gap-2"><Clock3 size={16} />تابع وقت الاستلام</span>
      </div>
    </section>
    <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">المطاعم</h2><span className="text-xs text-stone-400">{list.length} مطعم</span></div>
    <div className="directory-grid">
      {list.map((r) => <Link key={r.id} href={`/s/${r.slug}`} className="directory-store">
        <div className="directory-store-cover" style={{ backgroundColor: `${r.brandColor}18`, color: r.brandColor }}>
          {r.coverImageUrl ? <img src={r.coverImageUrl} alt="" /> : r.logoUrl ? <img src={r.logoUrl} alt="" style={{ width: '90px', height: '90px', objectFit: 'contain' }} /> : <span>{r.badgeText || r.nameAr.slice(0, 1)}</span>}
          <span className="absolute bottom-4 right-4 rounded-full bg-white/95 px-3 py-1 text-xs text-stone-700">{r.orderingStatus === 'OPEN' ? 'تصفح المنيو' : r.orderingStatus === 'PAUSED' ? 'الطلبات متوقفة مؤقتًا' : 'مغلق حاليًا'}</span>
        </div>
        <div className="directory-store-info"><div><h2>{r.nameAr}</h2><p className="mt-1 text-xs text-stone-500">{r.taglineAr || r.nameEn}</p></div><span className="grid size-10 place-items-center rounded-full border border-stone-200"><ArrowLeft size={17} /></span></div>
      </Link>)}
    </div>
    {list.length === 0 && <div className="card py-14 text-center"><UtensilsCrossed className="mx-auto mb-4 text-stone-400" /><p>المطاعم هتظهر هنا قريبًا.</p></div>}
    <footer className="mt-14 border-t border-stone-200 pt-6 text-center text-xs text-stone-400">طلب سهل. وقت واضح. أكل تستمتع بيه.</footer>
  </main>;
}
