import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { getLocale } from '@/lib/i18n/server';
import { text } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: text(await getLocale('customer'), 'سياسة الخصوصية', 'Privacy policy') };
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title={['سياسة الخصوصية', 'Privacy policy']}
      intro={(p) => [`إحنا في ${p.nameAr} بنجمع أقل بيانات محتاجينها عشان طلبك يوصل صح.`, `At ${p.nameEn} we collect only the data needed to get your order right.`]}
      sections={(p) => [
        { title: ['البيانات اللي بنجمعها', 'What we collect'], body: [
          ['اسمك ورقم موبايلك وتفاصيل الطلب ومكان الاستلام وطريقة الدفع، ورقم عملية التحويل وصورته لو رفعتها.', 'Your name, phone number, order details, pickup point and payment method, plus the transfer reference and screenshot if you upload one.'],
          ['عنوان الـIP ونوع المتصفح، لحماية المنصة من الإساءة والطلبات المتكررة وتسجيل العمليات الحساسة.', 'Your IP address and browser type, to protect the platform from abuse and repeated requests and to log sensitive actions.'],
        ] },
        { title: ['مين بيشوف بياناتك', 'Who sees your data'], body: [
          ['فريق المطعم اللي طلبت منه بس هو اللي بيشوف رقمك وتفاصيل طلبك عشان يجهّزه ويوصّله. إدارة المنصة بتشوفها للدعم والمحاسبة.', 'Only the team of the restaurant you ordered from sees your number and order details, to prepare and deliver it. Platform administrators see them for support and accounting.'],
          ['مش بنبيع بياناتك ومش بنستخدم أدوات إعلانات أو تتبع خارجية.', 'We do not sell your data and we do not use external advertising or tracking tools.'],
        ] },
        { title: ['على موبايلك', 'On your phone'], body: [
          ['آخر طلباتك وبياناتك (الاسم والرقم) بتتحفظ على موبايلك بس، عشان "طلباتي" و"اطلب نفس الطلب" والملء التلقائي. تقدر تمسحها من إعدادات المتصفح.', 'Your recent orders and details (name and number) are saved on your phone only, for “My orders”, “Order again” and auto-fill. You can clear them in your browser settings.'],
          ['رابط متابعة الطلب خاص بيك؛ أي حد معاه الرابط يقدر يشوف حالة الطلب.', 'Your tracking link is private; anyone with the link can see the order status.'],
        ] },
        { title: ['الاحتفاظ والحذف', 'Keeping and deleting data'], body: [
          ['بنحتفظ بسجلات الطلبات للمحاسبة وحل المشاكل. لو عايز تحذف بياناتك الشخصية تواصل معنا.', 'We keep order records for accounting and resolving problems. To delete your personal data, contact us.'],
          [`المنصة تُدار بواسطة ${p.companyAr}.`, `The platform is operated by ${p.companyEn}.`],
        ] },
      ]}
    />
  );
}
