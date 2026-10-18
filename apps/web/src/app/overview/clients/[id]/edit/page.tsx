import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ClientProfile } from '@crm/shared';
import { apiFetch, ApiError } from '@/lib/api';
import { requireRole } from '@/lib/session';
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
  await requireRole('manager');
  const { id } = await params;

  let client: ClientDetail;
  try {
    client = await apiFetch<ClientDetail>(`/clients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const consultants = await apiFetch<{ id: string; name: string }[]>('/consultants').catch(() => []);

  return (
    <div>
      <Link
        href={`/overview/clients/${id}`}
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> Back to {client.fullName}
      </Link>
      <PageHeader title="Edit client" subtitle="Contact details and the student profile. Changing the consultant hands over their open applications too." />
      <ClientForm
        mode="edit"
        clientId={id}
        withApplication={false}
        redirectBase="/overview/clients"
        consultants={consultants.map((c) => ({ id: c.id, name: c.name }))}
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
