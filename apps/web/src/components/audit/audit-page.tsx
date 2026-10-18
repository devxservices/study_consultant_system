import type { AuditEntryView, Paginated } from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { Card, EmptyState, PageHeader, buttonClass } from '../ui';
import { Pagination } from '../client-table';
import { IconDownload } from '../icons';
import { AuditFilters, type AuditFilterValues } from './audit-filters';
import { AuditList } from './audit-list';

type SearchParams = Record<string, string | string[] | undefined>;

export function auditFilterValues(sp: SearchParams): AuditFilterValues & { page: number; entityId?: string } {
  const one = (k: string) => {
    const v = Array.isArray(sp[k]) ? sp[k]![0] : sp[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  return {
    page: Math.max(1, Number(one('page')) || 1),
    category: one('category'),
    actorId: one('actorId'),
    from: one('from'),
    to: one('to'),
    q: one('q'),
    entityId: one('entityId'),
  };
}

/**
 * The whole consultancy's record, for managers and anyone they have given
 * "see the audit trail". Append-only: the database refuses to change or
 * delete a row, so what is here is what happened.
 */
export async function AuditPage({
  base,
  searchParams,
  canExport,
}: {
  base: '/overview' | '/desk';
  searchParams: SearchParams;
  canExport: boolean;
}) {
  const f = auditFilterValues(searchParams);
  const [data, people] = await Promise.all([
    apiFetch<Paginated<AuditEntryView>>(`/analytics/audit${qs({ ...f, pageSize: 50 })}`),
    apiFetch<{ id: string; name: string; active: boolean }[]>('/analytics/audit/people').catch(() => []),
  ]);
  const { page: _page, entityId, ...filters } = f;
  const about = entityId ? people.find((p) => p.id === entityId) : undefined;
  const buildHref = (p: number) => qs({ ...filters, entityId, page: p }) || '?';

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="Everything everyone did - who looked at which client, every document decision, every sign-in - with where it came from. Nothing here can be edited or deleted."
        actions={
          canExport ? (
            <a href={`/api/export/audit${qs({ from: f.from, to: f.to })}`} className={buttonClass('secondary')} download>
              <IconDownload size={16} />
              Download CSV
            </a>
          ) : undefined
        }
      />

      {entityId && (
        <p className="mb-3 text-[13px] text-ink-600">
          Showing changes made to <span className="font-medium text-ink-900">{about?.name ?? 'one person'}</span>.{' '}
          <a href={`${base}/audit`} className="font-medium text-brand-700 hover:underline">
            Show everything
          </a>
        </p>
      )}
      <AuditFilters
        action={`${base}/audit`}
        values={filters}
        people={people}
        hidden={entityId ? { entityId } : undefined}
      />

      {data.items.length === 0 ? (
        <Card>
          <EmptyState
            title={Object.values(filters).some(Boolean) ? 'Nothing matches those filters' : 'Nothing recorded yet'}
            description={
              Object.values(filters).some(Boolean)
                ? 'Try a wider date range or another kind of event.'
                : 'Sign-ins, views and changes will appear here as the team works.'
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <AuditList items={data.items} base={base} />
        </Card>
      )}

      <Pagination data={data} buildHref={buildHref} />
    </>
  );
}
