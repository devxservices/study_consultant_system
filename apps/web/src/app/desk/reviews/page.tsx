import Link from 'next/link';
import type { DocumentView, Paginated } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { DocumentCard } from '@/components/document-review';
import { Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';

export const metadata = { title: 'To review' };

/**
 * Everything waiting on this consultant, oldest first.
 *
 * This is the screen that answers "whose documents am I holding up?" - the
 * question a consultant with 50 clients needs answered in one glance. Grouped
 * by client so clearing one person's paperwork is a single pass rather than
 * hopping between cases.
 */
export default async function ReviewQueuePage() {
  const user = await requireRole('consultant');
  if (!can(user, 'document.view')) return <NoAccess title="To review" permission="document.view" />;

  const pending = await apiFetch<Paginated<DocumentView>>(
    '/documents?awaiting=true&pageSize=100&sort=oldest',
  );

  if (pending.items.length === 0) {
    return (
      <>
        <PageHeader title="To review" subtitle="Documents waiting on you." />
        <Card>
          <EmptyState
            title="Your queue is clear"
            description="Nothing is waiting on you right now. New uploads from your clients will land here."
            action={<LinkButton href="/desk/clients">Back to clients</LinkButton>}
          />
        </Card>
      </>
    );
  }

  // Group by client, preserving the oldest-first order the API returned.
  const groups = new Map<string, { name: string; caseId: string | null; clientId: string | null; docs: DocumentView[] }>();
  for (const d of pending.items) {
    const key = d.clientId ?? 'agency';
    const g = groups.get(key);
    if (g) g.docs.push(d);
    else groups.set(key, { name: d.clientName ?? 'Agency files', caseId: d.caseId, clientId: d.clientId, docs: [d] });
  }

  const oldestDays = Math.floor(
    (Date.now() - new Date(pending.items[0]!.uploadedAt).getTime()) / 86_400_000,
  );

  return (
    <>
      <PageHeader
        title="To review"
        subtitle={`${pending.total} document${pending.total === 1 ? '' : 's'} waiting across ${groups.size} client${groups.size === 1 ? '' : 's'}.`}
      />

      {oldestDays >= 3 && (
        <div className="mb-5 rounded-lg border border-warn-200 bg-warn-50 px-4 py-3">
          <p className="text-[14px] font-medium text-warn-700">
            The oldest document has been waiting {oldestDays} days.
          </p>
          <p className="mt-0.5 text-[13px] text-warn-700/85">
            Clients cannot move forward until these are reviewed.
          </p>
        </div>
      )}

      <div className="space-y-5">
        {[...groups.entries()].map(([clientId, group]) => (
          <section key={clientId}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-ink-950">{group.name}</h2>
              <Link
                href={group.caseId ? `/desk/cases/${group.caseId}` : `/desk/documents?clientId=${group.clientId}`}
                className="text-[13px] font-medium text-brand-700 hover:underline"
              >
                Open case
              </Link>
            </div>
            <Card className="divide-y divide-line overflow-hidden">
              {group.docs.map((d) => (
                <DocumentCard key={d.id} doc={d} showClient={false} />
              ))}
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}
