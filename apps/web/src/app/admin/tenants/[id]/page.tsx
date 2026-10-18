import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TENANT_STATUS_LABEL, type Currency, type PlanView, type SubscriptionPaymentView, type TenantDetail } from '@crm/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDate, relativeDays } from '@/lib/format';
import { BrandMark } from '@/components/brand-mark';
import { Avatar, Card, PageHeader, Panel, Pill } from '@/components/ui';
import { ActionButton } from '@/components/forms';
import { STATUS_TONE } from '@/components/admin/status';
import { TenantBranding } from '@/components/admin/tenant-branding';
import { DomainsCard } from '@/components/domains-card';
import { siteUrl } from '@/lib/site-url';
import { TenantStatusCard } from '@/components/admin/tenant-status';
import { TenantSubscription } from '@/components/admin/tenant-subscription';
import { ManagerLinkButton } from '@/components/admin/manager-link';
import { RecordSubscriptionPayment } from '@/components/admin/record-payment';
import { SubscriptionPayments } from '@/components/subscription-payments';

export const metadata = { title: 'Consultancy' };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let tenant: TenantDetail;
  try {
    tenant = await apiFetch<TenantDetail>(`/admin/tenants/${id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  const [plans, payments] = await Promise.all([
    apiFetch<PlanView[]>('/admin/plans'),
    apiFetch<SubscriptionPaymentView[]>(`/admin/tenants/${id}/payments`),
  ]);
  const plan = plans.find((p) => p.id === tenant.planId) ?? null;

  return (
    <>
      <Link
        href="/admin"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> Back to consultancies
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <BrandMark name={tenant.name} branding={tenant} size={52} />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={tenant.name}
            subtitle={
              <span className="inline-flex flex-wrap items-center gap-2">
                <Pill tone={STATUS_TONE[tenant.status]} dot>
                  {TENANT_STATUS_LABEL[tenant.status]}
                </Pill>
                <span>Added {formatDate(tenant.createdAt)}</span>
              </span>
            }
            actions={
              <a
                href={siteUrl(tenant.platformHost)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9.5 items-center rounded-lg border border-line-strong bg-paper px-4 text-sm font-medium text-ink-800 hover:bg-ink-50"
              >
                Open their portal
              </a>
            }
          />
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <TenantBranding tenant={tenant} />
          <DomainsCard base={`/api/admin/tenants/${tenant.id}`} platformHost={tenant.platformHost} domains={tenant.domains} audience="admin" />
          <Panel title="Payments for the platform" subtitle="What this consultancy has paid you, and the period each payment covers.">
            <SubscriptionPayments payments={payments} showRecordedBy />
          </Panel>
        </div>

        <div className="space-y-5">
          <TenantSubscription tenantId={tenant.id} planId={tenant.planId} entitlements={tenant.entitlements} plans={plans} />

          <RecordSubscriptionPayment
            tenantId={tenant.id}
            currency={(plan?.currency ?? (payments[0]?.currency as Currency | undefined) ?? 'PKR') as Currency}
            monthlyPrice={plan?.priceMonthly || null}
          />

          <TenantStatusCard tenant={tenant} />

          <Card className="p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-ink-950">At a glance</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <Figure label="Staff" value={tenant.counts.staff} />
              <Figure label="Clients" value={tenant.counts.clients} />
              <Figure label="Active cases" value={tenant.counts.activeCases} />
              <Figure label="Domains" value={tenant.counts.domains} />
            </dl>
            <p className="mt-3 text-[12px] text-ink-400">
              Counts only. The platform admin never sees a consultancy’s clients, cases or documents.
            </p>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-ink-950">Managers</h2>
            {tenant.managers.length === 0 ? (
              <p className="mt-2 text-[13px] text-ink-500">No active manager.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {tenant.managers.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2.5">
                    <Avatar name={m.fullName} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-ink-900">
                        {m.fullName}
                        {m.mfaEnabled && (
                          <Pill tone="ok" dot>
                            Two-step
                          </Pill>
                        )}
                      </p>
                      <p className="truncate text-[12px] text-ink-400">
                        {m.email} &middot;{' '}
                        {m.lastSignInAt ? `signed in ${relativeDays(m.lastSignInAt)}` : 'never signed in'}
                      </p>
                    </div>
                    {/* The owner's way back in when their phone and recovery codes are both gone. */}
                    {m.mfaEnabled && (
                      <ActionButton
                        url={`/api/admin/tenants/${tenant.id}/managers/${m.id}/mfa/reset`}
                        variant="ghost"
                        confirm={`Reset two-step verification for ${m.fullName}? Only do this after confirming who they are - they will sign in with their password alone until they set it up again.`}
                      >
                        Reset two-step
                      </ActionButton>
                    )}
                    <ManagerLinkButton tenantId={tenant.id} manager={m} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-400">{label}</dt>
      <dd className="tnum text-[20px] font-semibold leading-7 text-ink-950">{value}</dd>
    </div>
  );
}
