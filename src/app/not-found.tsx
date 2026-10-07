import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl">🔎</div>
      <h1 className="text-xl font-bold">الصفحة دي مش موجودة</h1>
      <Link href="/" className="btn btn-primary">الرئيسية</Link>
    </main>
  );
}
