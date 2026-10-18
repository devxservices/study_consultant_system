import Link from 'next/link';
import { TENANT_STATUS_LABEL, type PlatformReadiness, type TenantSummary } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { BrandMark } from '@/components/brand-mark';
import { Card, EmptyState, LinkButton, PageHeader, Pill, StatCard } from '@/components/ui';
import { STATUS_TONE } from '@/components/admin/status';
import { IconAlert, IconBuilding, IconChevronRight, IconReceipt, IconUsers } from '@/components/icons';
import { SubscriptionPill, paidUntilText } from '@/components/subscription-state';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Consultancies' };

/**
 * Every consultancy on the platform, as an account: who they are, whether
 * they are live, and how big they are. The counts are the most the platform
 * admin ever sees of what is inside one.
 */
export default async function AdminHomePage() {
  const [tenants, readiness] = await Promise.all([
    apiFetch<TenantSummary[]>('/admin/tenants'),
    apiFetch<PlatformReadiness>('/admin/platform/readiness').catch(() => null),
  ]);
  const todo = readiness?.checks.filter((c) => !c.ok) ?? [];

  const active = tenants.filter((t) => t.status === 'active').length;
  const offline = tenants.length - active;
  const clients = tenants.reduce((n, t) => n + t.counts.clients, 0);
  const live = tenants.filter((t) => t.status === 'active');
  const overdue = live.filter((t) => t.subscription.access !== 'open').length;
  const endingSoon = live.filter((t) => t.subscription.access === 'open' && t.subscription.endingSoon && t.subscriptionStatus !== 'cancelled').length;

  return (
    <>
      <PageHeader
        title="Consultancies"
        subtitle="Every consultancy on the platform, its address and whether it is live."
        actions={<LinkButton href="/admin/tenants/new">Add consultancy</LinkButton>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Live consultancies"
          value={active}
          hint={`${tenants.length} on the platform`}
          icon={<IconBuilding size={20} />}
        />
        <StatCard
          label="Suspended or closed"
          value={offline}
          tone={offline ? 'warn' : 'neutral'}
          hint="Locked out, records kept"
          icon={<IconAlert size={20} />}
        />
        <StatCard
          label="Renewals to chase"
          value={overdue + endingSoon}
          tone={overdue ? 'bad' : endingSoon ? 'warn' : 'neutral'}
          hint={`${overdue} overdue · ${endingSoon} due within a week`}
          icon={<IconReceipt size={20} />}
        />
        <StatCard
          label="Clients across the platform"
          value={clients.toLocaleString()}
          hint="Not archived"
          icon={<IconUsers size={20} />}
        />
      </div>

      {readiness && <Readiness readiness={readiness} open={todo.length > 0} />}

      <Card className="mt-5 overflow-hidden">
        {tenants.length === 0 ? (
          <EmptyState
            title="No consultancies yet"
            description="Add the first consultancy and its manager. The manager is emailed a link to choose a password."
            action={<LinkButton href="/admin/tenants/new">Add a consultancy</LinkButton>}
          />
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[900px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-[12.5px] text-ink-500">
                  <th className="px-5 py-3 font-medium">Consultancy</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Plan</th>
                  <th className="px-3 py-3 font-medium">Subscription</th>
                  <th className="px-3 py-3 text-right font-medium">Staff</th>
                  <th className="px-3 py-3 text-right font-medium">Clients</th>
                  <th className="px-3 py-3 text-right font-medium">Active cases</th>
                  <th className="px-3 py-3 text-right font-medium">Domains</th>
                  <th className="px-3 py-3 font-medium">Added</th>
                  <th className="w-10 px-3 py-3" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="group border-b border-line transition-colors last:border-0 hover:bg-ink-50">
                    <td className="px-5 py-3">
                      <Link href={`/admin/tenants/${t.id}`} className="flex items-center gap-3">
                        <BrandMark name={t.name} branding={t} size={34} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink-950 transition-colors group-hover:text-brand-700">
                            {t.name}
                          </span>
                          <span className="block truncate text-[12px] text-ink-400">
                            {t.platformHost}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <Pill tone={STATUS_TONE[t.status]} dot>
                        {TENANT_STATUS_LABEL[t.status]}
                      </Pill>
                    </td>
                    <td className="px-3 py-3 text-ink-700">{t.planName ?? <span className="text-ink-400">No plan</span>}</td>
                    <td className="px-3 py-3">
                      <SubscriptionPill state={t.subscription} status={t.subscriptionStatus} />
                      <span className="mt-0.5 block text-[12px] text-ink-400">{paidUntilText(t.subscription, t.subscriptionStatus)}</span>
                    </td>
                    <td className="tnum px-3 py-3 text-right text-ink-700">{t.counts.staff}</td>
                    <td className="tnum px-3 py-3 text-right text-ink-700">{t.counts.clients}</td>
                    <td className="tnum px-3 py-3 text-right text-ink-700">
                      {t.counts.activeCases}
                    </td>
                    <td className="tnum px-3 py-3 text-right text-ink-700">{t.counts.domains}</td>
                    <td className="px-3 py-3 text-ink-500">{formatDate(t.createdAt)}</td>
                    <td className="px-3 py-3 text-ink-300">
                      <Link href={`/admin/tenants/${t.id}`} aria-label={`Open ${t.name}`}>
                        <IconChevronRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/**
 * The launch checklist: what each outside service is set to. Collapsed once
 * everything is in place; open while something still needs doing.
 */
function Readiness({ readiness, open }: { readiness: PlatformReadiness; open: boolean }) {
  const left = readiness.checks.filter((c) => !c.ok).length;
  return (
    <Card className="mt-5 p-4 sm:p-5">
      <details open={open}>
        <summary className="flex cursor-pointer list-none items-center gap-2">
          <span className="text-[15px] font-semibold text-ink-950">Platform setup</span>
          {left ? (
            <Pill tone="warn" dot>
              {left} to look at
            </Pill>
          ) : (
            <Pill tone="ok" dot>
              Ready
            </Pill>
          )}
          <span className="ml-auto text-[12.5px] text-ink-400">Server settings, see the launch guide</span>
        </summary>
        <ul className="mt-3 divide-y divide-line">
          {readiness.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-3 py-2.5 text-[13px]">
              <Pill tone={c.ok ? 'ok' : 'warn'} dot>
                {c.ok ? 'Set' : 'Check'}
              </Pill>
              <div className="min-w-0">
                <p className="font-medium text-ink-900">{c.label}</p>
                <p className="text-ink-500">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
