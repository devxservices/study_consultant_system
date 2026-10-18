import type { PlatformSettingsView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { BillingSettingsForm, LegalSettingsForm } from '@/components/admin/platform-settings';

export const metadata = { title: 'Settings' };

/** The platform's own settings: how consultancies pay, and the published terms and privacy policy. */
export default async function AdminSettingsPage() {
  const settings = await apiFetch<PlatformSettingsView>('/admin/platform/settings');
  return (
    <>
      <PageHeader title="Settings" subtitle="How consultancies pay you, and the terms and privacy policy everyone is shown." />
      <div className="grid items-start gap-5 xl:grid-cols-[1fr_1.4fr]">
        <BillingSettingsForm settings={settings.billing} />
        <LegalSettingsForm settings={settings.legal} />
      </div>
    </>
  );
}
