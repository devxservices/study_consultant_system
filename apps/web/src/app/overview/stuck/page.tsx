import Link from 'next/link';
import type { Paginated } from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { StuckCaseRow, type StuckCase } from '@/components/stuck-cases';
import { Pagination } from '@/components/client-table';

export const metadata = { title: 'Not moving' };

interface ConsultantSummary { id: string; name: string }

/**
 * Every case past the limit for its stage, worst first. This is the list a
 * manager works through - the point of the product is that nothing sits here
 * unnoticed for two weeks.
 */
export default async function StuckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const page = Number(one('page') ?? 1);
  const consultantId = one('consultantId');

  const [data, consultants] = await Promise.all([
    apiFetch<Paginated<StuckCase>>(`/analytics/stuck${qs({ page, pageSize: 25, consultantId })}`),
    apiFetch<ConsultantSummary[]>('/consultants'),
  ]);

  const buildHref = (p: number) => qs({ page: p, consultantId }) || '?';

  return (
    <>
      <PageHeader
        title="Not moving"
        subtitle={
          data.total === 0
            ? 'Nothing has stalled.'
            : `${data.total} case${data.total === 1 ? '' : 's'} past the limit for their stage.`
        }
      />

      {/* Filter by consultant - the usual next question after "how many". */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip href="/overview/stuck" active={!consultantId} label="Everyone" />
        {consultants.map((c) => (
          <FilterChip
            key={c.id}
            href={`/overview/stuck?consultantId=${c.id}`}
            active={consultantId === c.id}
            label={c.name}
          />
        ))}
      </div>

      {data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing is stalled"
            description="Every active case is within the expected time for its stage. This list fills up on its own when something stops moving."
            action={<LinkButton href="/overview">Back to overview</LinkButton>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {data.items.map((c) => (
              <StuckCaseRow key={c.id} item={c} href={`/overview/cases/${c.id}`} />
            ))}
          </ul>
        </Card>
      )}

      <Pagination data={data} buildHref={buildHref} />
    </>
  );
}

/** `Link`, not a bare anchor: a bare one reloads the whole app to change a filter. */
function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={
        active
          ? 'rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-[13px] font-medium text-brand-700'
          : 'rounded-full border border-line bg-paper px-3 py-1.5 text-[13px] text-ink-600 shadow-card hover:bg-ink-50'
      }
    >
      {label}
    </Link>
  );
}
