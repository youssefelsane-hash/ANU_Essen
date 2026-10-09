'use client';

import { ActionForm, SubmitButton } from '@/components/forms';
import { useLanguage } from '@/components/language-provider';
import { replyTicketAction, setTicketStatusAction } from '@/server/actions/support';

export function StaffTicketActions({ ticketId, status }: { ticketId: string; status: string }) {
  const { t } = useLanguage();
  return (
    <div className="card space-y-3">
      <ActionForm action={replyTicketAction} className="space-y-2">
        <input type="hidden" name="ticketId" value={ticketId} />
        <label className="block"><span className="label">{t('ردك على العميل', 'Your reply to the customer')}</span><textarea name="body" className="input" rows={4} required minLength={2} maxLength={2000} placeholder={t('مثلاً: آسفين جدًا، رجّعنالك ثمن المشروب على إنستاباي.', 'e.g. We are sorry — we refunded the drink by InstaPay.')} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="close" value="1" /> {t('اقفل الشكوى بعد الرد (اتحلّت)', 'Close the request after replying (solved)')}</label>
        <SubmitButton>{t('إرسال الرد', 'Send reply')}</SubmitButton>
      </ActionForm>
      <ActionForm action={setTicketStatusAction}>
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="status" value={status === 'CLOSED' ? 'OPEN' : 'CLOSED'} />
        <SubmitButton className="btn btn-ghost btn-sm">{status === 'CLOSED' ? t('إعادة فتح الشكوى', 'Reopen') : t('اقفل من غير رد', 'Close without reply')}</SubmitButton>
      </ActionForm>
    </div>
  );
}
