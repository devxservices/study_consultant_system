import type { Paginated } from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { ClientTable, Pagination, type ClientListItem } from '@/components/client-table';
import { ClientFilters } from '@/components/client-filters';
import { LinkButton, PageHeader } from '@/components/ui';

export const metadata = { title: 'All clients' };

interface ConsultantSummary {
  id: string;
  name: string;
}

/** Same table the consultants use, with the consultant column turned on. */
export default async function AllClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;

  const query = qs({
    page: Number(one('page') ?? 1),
    pageSize: 25,
    q: one('q'),
    stage: one('stage'),
    programme: one('programme'),
    consultantId: one('consultantId'),
    createdFrom: one('createdFrom'),
    createdTo: one('createdTo'),
    includeArchived: one('includeArchived'),
    sort: one('sort') ?? 'recent',
  });

  const [data, consultants] = await Promise.all([
    apiFetch<Paginated<ClientListItem>>(`/clients${query}`),
    apiFetch<ConsultantSummary[]>('/consultants'),
  ]);

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) params.set(k, v);
    params.set('page', String(p));
    return `?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="All clients"
        subtitle="Every client in the consultancy, across all consultants."
        actions={<LinkButton href="/overview/clients/new">Add client</LinkButton>}
      />
      <ClientFilters consultants={consultants} showConsultantFilter showDateFilter />
      <ClientTable
        data={data}
        basePath="/overview/clients"
        showConsultant
        emptyAction={
          one('q') || one('stage') || one('programme') || one('consultantId') || one('createdFrom') ? (
            <LinkButton href="/overview/clients" variant="secondary">
              Clear filters
            </LinkButton>
          ) : (
            <LinkButton href="/overview/clients/new">Add a client</LinkButton>
          )
        }
      />
      <Pagination data={data} buildHref={buildHref} />
    </>
  );
}
