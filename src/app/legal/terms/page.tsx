import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: text(await getLocale('customer'), 'شروط الاستخدام', 'Terms of use') };
}

export default function TermsPage() {
  return (
    <LegalPage
      title={['شروط الاستخدام', 'Terms of use']}
      intro={(p) => [`باستخدامك ${p.nameAr} انت موافق على الشروط دي.`, `By using ${p.nameEn} you agree to these terms.`]}
      sections={(p) => [
        { title: ['دور المنصة', 'What the platform does'], body: [
          [`${p.nameAr} وسيط بيوصّل طلبك للمطعم. كل مطعم مسؤول عن أكله وأسعاره وجودته والفلوس اللي بيستلمها.`, `${p.nameEn} passes your order to the restaurant. Each restaurant is responsible for its food, prices, quality and the money it receives.`],
        ] },
        { title: ['الطلب والوقت', 'Orders and timing'], body: [
          ['وقت التجهيز اللي بيظهرلك تقدير بيتحسب من ضغط المطبخ الحالي، وبيتحدّث لحظة بلحظة، ومش وعد ثابت.', 'The ready time you see is an estimate based on the kitchen’s current load; it updates live and is not a fixed promise.'],
          ['اكتب اسمك ورقمك صح عشان المطعم يقدر يوصلك.', 'Enter your real name and number so the restaurant can reach you.'],
        ] },
        { title: ['الدفع', 'Payment'], body: [
          ['الأسعار الظاهرة في المنيو وشاشة التأكيد هي الأسعار المعتمدة لطلبك. يظهر التوصيل والإجمالي بوضوح قبل التأكيد.', 'The prices shown in the menu and confirmation screen are the prices that apply to your order. Delivery and the final total are shown clearly before confirmation.'],
          ['الدفع كاش عند الاستلام أو تحويل إنستاباي على حساب المطعم. طلب إنستاباي بيتأكد بعد ما المطعم يراجع التحويل، ولو ما اتدفعش في المهلة بيتلغي تلقائيًا.', 'Pay cash on pickup or by InstaPay to the restaurant’s account. An InstaPay order is confirmed once the restaurant checks the transfer, and it is cancelled automatically if not paid in time.'],
        ] },
        { title: ['الإلغاء والاسترجاع', 'Cancellations and refunds'], body: [
          ['حسب سياسة الإلغاء والاسترجاع المنشورة على المنصة.', 'As described in the cancellation & refund policy published on the platform.'],
        ] },
        { title: ['الاستخدام السليم', 'Fair use'], body: [
          ['ممنوع الطلبات الوهمية أو إساءة استخدام المنصة؛ المنصة ممكن توقف أي استخدام مسيء.', 'Fake orders or misuse are not allowed; the platform may block abusive use.'],
          [`كل المحتوى والتصميم مملوك لـ ${p.companyAr}. ممكن نحدّث الشروط دي، والنسخة المنشورة هنا هي المعمول بيها.`, `All content and design are owned by ${p.companyEn}. We may update these terms; the version published here applies.`],
        ] },
      ]}
    />
  );
}
