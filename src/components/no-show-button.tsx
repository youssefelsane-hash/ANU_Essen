'use client';

import { UserX } from 'lucide-react';
import { ActionForm, SubmitButton } from './forms';
import { useLanguage } from './language-provider';
import { markNoShowAction } from '@/server/actions/orders';

/** Staff: the customer never collected a ready order. */
export function NoShowButton({ orderId }: { orderId: string }) {
  const { t } = useLanguage();
  return (
    <ActionForm action={markNoShowAction} className="rounded-xl border border-red-200 bg-red-50 p-3" confirm={t('متأكد إن العميل ما استلمش؟ الطلب هيتلغي ويتسجل على رقمه.', 'Confirm the customer never collected it? The order is cancelled and counted on their number.')}>
      <input type="hidden" name="orderId" value={orderId} />
      <p className="mb-2 text-xs text-red-900">{t('الطلب جاهز والعميل ما جاش؟ سجّلها هنا. لو اتكررت مع نفس الرقم، الكاش بيتقفل عليه ويدفع إنستاباي بس.', 'Ready but nobody came? Record it here. If it repeats on the same number, cash is turned off for it (InstaPay only).')}</p>
      <SubmitButton className="btn btn-danger btn-sm"><UserX size={15} />{t('العميل ما استلمش', 'Customer did not collect')}</SubmitButton>
    </ActionForm>
  );
}
