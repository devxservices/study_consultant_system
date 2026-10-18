import Link from 'next/link';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { ClientForm } from '@/components/client-form';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Add client' };

export default async function NewClientPage() {
  const user = await requireRole('consultant');
  if (!can(user, 'client.create')) return <NoAccess title="Add a client" permission="client.create" />;

  return (
    <div>
      <Link
        href="/desk/clients"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> Back to clients
      </Link>
      <PageHeader
        title="Add a client"
        subtitle="They will be assigned to you. A manager can move them later if needed."
      />
      <ClientForm mode="create" />
    </div>
  );
}
