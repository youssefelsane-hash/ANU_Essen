'use client';

import { ActionForm, SubmitButton } from '@/components/forms';
import { useLanguage } from '@/components/language-provider';
import { replyReviewAction, setReviewHiddenAction } from '@/server/actions/support';

export function ReviewActions({ reviewId, reply, isHidden, canModerate }: { reviewId: string; reply: string | null; isHidden: boolean; canModerate: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <ActionForm action={replyReviewAction} className="flex min-w-0 flex-1 gap-2">
        <input type="hidden" name="reviewId" value={reviewId} />
        <input name="reply" defaultValue={reply ?? ''} maxLength={500} className="input" placeholder={t('رد علني تحت التقييم (اختياري)', 'Public reply under the review (optional)')} aria-label={t('الرد', 'Reply')} />
        <SubmitButton className="btn btn-secondary btn-sm shrink-0">{t('حفظ الرد', 'Save reply')}</SubmitButton>
      </ActionForm>
      {canModerate && (
        <ActionForm action={setReviewHiddenAction}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="hidden" value={isHidden ? '0' : '1'} />
          <SubmitButton className="btn btn-ghost btn-sm">{isHidden ? t('إظهار', 'Show') : t('إخفاء (مسيء)', 'Hide (abusive)')}</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
