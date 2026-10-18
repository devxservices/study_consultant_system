import Link from 'next/link';
import { PERMISSION_META, type RoleTemplateView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { Card, LinkButton, PageHeader, Pill } from '@/components/ui';
import { IconPlus } from '@/components/icons';

export const metadata = { title: 'Roles' };

/**
 * The consultancy's roles: named sets of permissions - Accountant, Trainer,
 * Senior consultant - handed to staff instead of ticking the same boxes for
 * each person.
 */
export default async function RolesPage() {
  const roles = await apiFetch<RoleTemplateView[]>('/team/roles');

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="Give staff a role and they get its permissions. A person’s own setting still wins, and managers always have everything."
        actions={
          <LinkButton href="/overview/roles/new">
            <IconPlus size={16} />
            New role
          </LinkButton>
        }
      />

      {roles.length === 0 ? (
        <Card className="p-8 text-center text-[13.5px] text-ink-500">No roles yet. Create the first one.</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => {
            const allowed = Object.entries(r.effects).filter(([, e]) => e === 'allow');
            const denied = Object.entries(r.effects).filter(([, e]) => e === 'deny');
            return (
              <Link key={r.id} href={`/overview/roles/${r.id}`} className="lift press block rounded-xl bg-paper p-4 shadow-card sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] font-semibold text-ink-950">{r.name}</p>
                  <Pill tone="info">
                    {r.members} {r.members === 1 ? 'person' : 'people'}
                  </Pill>
                </div>
                {r.description && <p className="mt-1 text-[13px] leading-snug text-ink-500">{r.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {!r.takesClients && <Pill tone="neutral">No caseload</Pill>}
                  {allowed.length === 0 && denied.length === 0 && <Pill tone="neutral">Consultancy defaults</Pill>}
                  {allowed.slice(0, 4).map(([p]) => (
                    <Pill key={p} tone="ok">
                      {PERMISSION_META[p as keyof typeof PERMISSION_META]?.label ?? p}
                    </Pill>
                  ))}
                  {allowed.length > 4 && <Pill tone="ok">+{allowed.length - 4} more</Pill>}
                  {denied.length > 0 && <Pill tone="bad">{denied.length} held back</Pill>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
