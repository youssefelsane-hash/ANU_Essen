import { adminPage, getSetting } from '@/server/admin-guard';
import { saveSettingsAction } from '@/server/actions/admin-platform';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Forbidden, PageTitle } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  if (!(await adminPage('/admin/settings', 'platform.settings'))) return <Forbidden />;
  const [name, tz, commission] = await Promise.all([
    getSetting('platform.name', 'Campus Order'),
    getSetting('platform.timezone', 'Africa/Cairo'),
    getSetting('defaults.commissionBps', 500),
  ]);
  return (
    <div className="max-w-xl">
      <PageTitle title="System settings" subtitle="Platform-wide defaults. Per-restaurant values live on each restaurant." />
      <ActionForm action={saveSettingsAction} className="card space-y-3">
        <div><label className="label">Platform name</label><input name="platformName" defaultValue={name} className="input" /></div>
        <div><label className="label">Reporting timezone</label><input name="timezone" defaultValue={tz} className="input" /></div>
        <div><label className="label">Default commission for new restaurants (%)</label><input name="defaultCommissionPercent" defaultValue={commission / 100} className="input" inputMode="decimal" /></div>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
      <p className="mt-3 text-xs text-gray-500">The default queue configuration for new restaurants is stored as <code>defaults.queue</code>; each restaurant&apos;s own engine is edited on its “Queue &amp; ETA” tab.</p>
    </div>
  );
}
