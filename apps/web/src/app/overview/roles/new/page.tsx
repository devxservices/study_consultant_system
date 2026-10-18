import type { ConsultancyDefaults } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { enabledModules } from '@/lib/entitlements';
import { PageHeader } from '@/components/ui';
import { PermissionEditor } from '@/components/team/permission-editor';

export const metadata = { title: 'New role' };

export default async function NewRolePage() {
  const [defaults, modules] = await Promise.all([apiFetch<ConsultancyDefaults>('/team/defaults'), enabledModules()]);
  return (
    <>
      <PageHeader
        title="New role"
        subtitle="Name it, then allow or deny only what differs from the consultancy’s defaults."
        breadcrumb={[{ href: '/overview/roles', label: 'Roles' }, { label: 'New role' }]}
      />
      <PermissionEditor mode="role" role={null} defaults={defaults} modules={[...modules]} />
    </>
  );
}
