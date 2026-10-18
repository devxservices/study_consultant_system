import { notFound } from 'next/navigation';
import type { ConsultancyDefaults, RoleTemplateView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { enabledModules } from '@/lib/entitlements';
import { PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/forms';
import { PermissionEditor } from '@/components/team/permission-editor';

export const metadata = { title: 'Role' };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [roles, defaults, modules] = await Promise.all([
    apiFetch<RoleTemplateView[]>('/team/roles'),
    apiFetch<ConsultancyDefaults>('/team/defaults'),
    enabledModules(),
  ]);
  const role = roles.find((r) => r.id === id);
  if (!role) notFound();

  return (
    <>
      <PageHeader
        title={role.name}
        subtitle={
          role.members
            ? `${role.members} ${role.members === 1 ? 'person has' : 'people have'} this role. Changes reach them on their next click.`
            : 'Nobody has this role yet. Give it to someone from their page on the team.'
        }
        breadcrumb={[{ href: '/overview/roles', label: 'Roles' }, { label: role.name }]}
        actions={
          <ActionButton
            url={`/api/team/roles/${role.id}`}
            method="DELETE"
            variant="ghost"
            redirectTo="/overview/roles"
            confirm={`Remove the ${role.name} role? ${role.members ? 'Its members go back to the consultancy’s defaults.' : ''}`}
          >
            Remove role
          </ActionButton>
        }
      />
      <PermissionEditor key={role.id} mode="role" role={role} defaults={defaults} modules={[...modules]} />
    </>
  );
}
