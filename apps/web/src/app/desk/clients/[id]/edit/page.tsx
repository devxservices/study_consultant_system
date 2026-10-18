import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ClientProfile } from '@crm/shared';
import { apiFetch, ApiError } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { ClientForm } from '@/components/client-form';
import { profileValues } from '@/lib/client-values';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Edit client' };

interface ClientDetail {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  city: string | null;
  notes: string | null;
  profile: ClientProfile;
  consultant: { id: string } | null;
}

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  if (!can(user, 'client.edit')) return <NoAccess title="Edit client" permission="client.edit" />;
  const { id } = await params;

  let client: ClientDetail;
  try {
    client = await apiFetch<ClientDetail>(`/clients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  // Handing a client to a colleague needs "reassign clients", and the team list to pick from.
  const consultants =
    can(user, 'client.assign') && can(user, 'staff.view')
      ? await apiFetch<{ id: string; name: string }[]>('/consultants').catch(() => null)
      : null;


  return (
    <div>
      <Link
        href={`/desk/clients/${id}`}
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> Back to {client.fullName}
      </Link>
      <PageHeader title="Edit client" subtitle="Contact details and the student profile." />
      <ClientForm
        mode="edit"
        clientId={id}
        withApplication={false}
        redirectBase="/desk/clients"
        consultants={consultants?.map((c) => ({ id: c.id, name: c.name }))}
        initial={{
          fullName: client.fullName,
          email: client.email,
          phone: client.phone,
          city: client.city ?? '',
          notes: client.notes ?? '',
          assignedConsultantId: client.consultant?.id ?? '',
          ...profileValues(client.profile),
        }}
      />
    </div>
  );
}
