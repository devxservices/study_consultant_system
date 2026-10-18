import Link from 'next/link';
import { requireRole } from '@/lib/session';
import { apiFetch } from '@/lib/api';
import { ClientForm } from '@/components/client-form';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Add client' };

interface ConsultantSummary {
  id: string;
  name: string;
}

export default async function ManagerNewClientPage() {
  await requireRole('manager');
  const consultants = await apiFetch<ConsultantSummary[]>('/consultants').catch(() => []);

  return (
    <div>
      <Link
        href="/overview/clients"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> Back to all clients
      </Link>
      <PageHeader
        title="Add a client"
        subtitle="Create the client record and, if you like, assign a consultant now."
      />
      <ClientForm
        mode="create"
        redirectBase="/overview/clients"
        consultants={consultants.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
