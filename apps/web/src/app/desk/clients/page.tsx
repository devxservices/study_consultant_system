import type { Paginated } from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ClientTable, Pagination, type ClientListItem } from '@/components/client-table';
import { ClientFilters } from '@/components/client-filters';
import { LinkButton, PageHeader } from '@/components/ui';
import { IconPlus } from '@/components/icons';

export const metadata = { title: 'Clients' };

export default async function DeskClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole('consultant');
  const sp = await searchParams;

  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const page = Number(one('page') ?? 1);
  const term = one('q');

  const query = qs({
    page,
    pageSize: 25,
    q: term,
    stage: one('stage'),
    programme: one('programme'),
    sort: one('sort') ?? 'recent',
  });

  const data = await apiFetch<Paginated<ClientListItem>>(`/clients${query}`);

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === 'string' && v) params.set(k, v);
    }
    params.set('page', String(p));
    return `?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        breadcrumb={[{ href: '/desk', label: 'Dashboard' }, { label: 'Clients' }]}
        title="Clients"
        subtitle={
          term
            ? `${data.total} client${data.total === 1 ? '' : 's'} matching “${term}”.`
            : can(user, 'client.view_all')
              ? 'Every client in the consultancy, and what each of them is waiting on.'
              : 'Everyone assigned to you, and what each of them is waiting on.'
        }
        actions={
          can(user, 'client.create') ? (
            <LinkButton href="/desk/clients/new">
              <IconPlus size={16} />
              Add client
            </LinkButton>
          ) : undefined
        }
      />

      <ClientFilters />

      <ClientTable
        data={data}
        basePath="/desk/clients"
        emptyAction={
          term || one('stage') || one('programme') ? (
            <LinkButton href="/desk/clients" variant="secondary">
              Clear filters
            </LinkButton>
          ) : can(user, 'client.create') ? (
            <LinkButton href="/desk/clients/new">Add a client</LinkButton>
          ) : undefined
        }
      />

      <Pagination data={data} buildHref={buildHref} />
    </>
  );
}
