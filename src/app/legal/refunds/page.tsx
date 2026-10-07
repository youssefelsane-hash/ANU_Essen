import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { REFUND_REQUEST_WINDOW_HOURS } from '@/server/services/refunds';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: text(await getLocale('customer'), 'الإلغاء والاسترجاع', 'Cancellations & refunds') };
}

export default function RefundPolicyPage() {
  const hours = REFUND_REQUEST_WINDOW_HOURS;
  return (
    <LegalPage
      title={['سياسة الإلغاء والاسترجاع', 'Cancellation & refund policy']}
      intro={(p) => [`${p.nameAr} بتوصّلك بالمطعم مباشرة: الفلوس بتتدفع للمطعم نفسه (كاش أو إنستاباي على حساب المطعم)، والمطعم هو اللي بيرجّعها لو في استرجاع.`, `${p.nameEn} connects you directly with the restaurant: you pay the restaurant itself (cash or InstaPay to the restaurant's account), and the restaurant gives the money back when a refund applies.`]}
      sections={() => [
        { title: ['إلغاء الطلب', 'Cancelling an order'], body: [
          ['تقدر تلغي طلبك بنفسك من صفحة متابعة الطلب طول ما المطعم لسه ما قبلهوش أو لسه ما دفعتش.', 'You can cancel from the tracking page while the restaurant has not accepted it yet or before you pay.'],
          ['بعد ما المطعم يقبل الطلب ويبدأ يحضّره، كلّم المطعم من زرار الاتصال في صفحة الطلب.', 'Once the restaurant accepts and starts preparing, call the restaurant from the order page.'],
        ] },
        { title: ['لو المطعم لغى الطلب بعد ما دفعت', 'If the restaurant cancels after you paid'], body: [
          ['لو حوّلت بإنستاباي والمطعم لغى الطلب، المبلغ كله بيترجعلك. الطلب ده بيظهر عند المطعم في قائمة "اتلغت بعد ما العميل دفع" لحد ما يرجّع الفلوس.', 'If you paid by InstaPay and the restaurant cancels, you get the full amount back. The order stays on the restaurant’s “cancelled after payment” list until it is refunded.'],
        ] },
        { title: ['مشكلة في الطلب', 'A problem with your order'], body: [
          [`لو في صنف ناقص أو غلط أو مشكلة في الأكل، اطلب استرجاع من صفحة متابعة الطلب ("في مشكلة؟ اطلب استرجاع فلوسك") خلال ${hours} ساعة من تسليم الطلب.`, `For a missing or wrong item or a problem with the food, request a refund from the tracking page (“Problem? Ask for a refund”) within ${hours} hours of receiving the order.`],
          ['المطعم بيراجع الطلب ويقرر استرجاع كامل أو جزئي، أو يرد عليك بالسبب لو رفض. القرار بيظهرلك في نفس الصفحة.', 'The restaurant reviews it and refunds all or part of the amount, or replies with a reason if it declines. You see the decision on the same page.'],
          ['استرجاع إنستاباي بيتحوّل على العنوان أو الرقم اللي بتكتبه في الطلب؛ واسترجاع الكاش بيكون من المطعم.', 'InstaPay refunds go to the address or number you enter in the request; cash refunds are given by the restaurant.'],
        ] },
        { title: ['عمولة المنصة', 'Platform commission'], body: [
          ['العميل ما بيدفعش أي رسوم للمنصة. ولو المطعم رجّع مبلغ، عمولة المنصة على الجزء ده بتتلغي تلقائيًا.', 'Customers pay no platform fee. When a restaurant refunds an amount, the platform commission on that amount is cancelled automatically.'],
        ] },
      ]}
    />
  );
}
