import Link from 'next/link';
import { localIsoDateIn, type PlatformSettingsView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { TenantCreateForm } from '@/components/admin/tenant-create-form';

export const metadata = { title: 'Add consultancy' };

export default async function NewTenantPage() {
  const [{ platformDomain }, settings] = await Promise.all([
    apiFetch<{ platformDomain: string }>('/admin/platform'),
    apiFetch<PlatformSettingsView>('/admin/platform/settings'),
  ]);
  const trialDays = settings.billing.trialDays;

  return (
    <div>
      <Link
        href="/admin"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> Back to consultancies
      </Link>
      <PageHeader
        title="Add a consultancy"
        subtitle="Creates an empty workspace and its first manager. Nothing from any other consultancy is visible in it."
      />
      <TenantCreateForm platformDomain={platformDomain} trialEndsOn={trialDays > 0 ? localIsoDateIn(trialDays) : ''} />
    </div>
  );
}
