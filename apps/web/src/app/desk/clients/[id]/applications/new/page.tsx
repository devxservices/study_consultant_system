import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { CaseForm } from '@/components/case-form';
import type { CountryView, WorkflowSummaryView } from '@crm/shared';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'New application' };

export default async function NewApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  if (!can(user, 'case.create')) return <NoAccess title="Open an application" permission="case.create" />;
  const { id } = await params;

  // Fetched alongside the client, so the form costs no extra round trip.
  const extras = Promise.all([
    apiFetch<WorkflowSummaryView[]>('/workflows').catch(() => [] as WorkflowSummaryView[]),
    apiFetch<CountryView[]>('/countries').catch(() => [] as CountryView[]),
  ]);
  let client: { id: string; fullName: string };
  try {
    client = await apiFetch<{ id: string; fullName: string }>(`/clients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }

  const [workflows, countries] = await extras;

  return (
    <div>
      <Link
        href={`/desk/clients/${id}`}
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> Back to {client.fullName}
      </Link>
      <PageHeader title="New application" subtitle={`Another country or university for ${client.fullName}. It starts at the first stage of its workflow.`} />
      <CaseForm clientId={client.id} base="/desk" workflows={workflows} countries={countries} />
    </div>
  );
}
