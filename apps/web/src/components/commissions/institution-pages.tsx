import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AGREEMENT_STATUS_LABEL,
  COMMISSION_STAGE_LABEL,
  COMMISSION_STAGE_TONE,
  INSTITUTION_TYPE_LABEL,
  STAGE_DEFINITIONS,
  describeCondition,
  formatMoney,
  type AuthUser,
  type CommissionView,
  type InstitutionSummaryView,
  type InstitutionView,
  type Paginated,
} from '@crm/shared';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, EmptyState, LinkButton, PageHeader, Panel, Pill, cx } from '../ui';
import { IconPlus } from '../icons';
import { MoneyTable } from '../finance/workspace';
import { AgreementDocument, AgreementEditor, InstitutionForm } from './institution-forms';

export const universitiesBase = (user: AuthUser) => (user.role === 'manager' ? '/overview/universities' : '/desk/universities');
export const commissionsBase = (user: AuthUser) => (user.role === 'manager' ? '/overview/commissions' : '/desk/commissions');

export async function InstitutionsPage({ user, query }: { user: AuthUser; query: { q?: string; country?: string; all?: string } }) {
  const base = universitiesBase(user);
  const list = await apiFetch<InstitutionSummaryView[]>(`/institutions${qs({ q: query.q, country: query.country, includeInactive: query.all === '1' ? 'true' : undefined })}`);
  const money = can(user, 'commission.view');
  return (
    <>
      <PageHeader
        title="Universities"
        subtitle="The institutions you send students to, the people there, and the agreements that pay you commission."
        actions={
          can(user, 'institution.manage') ? (
            <LinkButton href={`${base}/new`}>
              <IconPlus size={16} />
              Add institution
            </LinkButton>
          ) : undefined
        }
      />
      <form action={base} className="mb-3 flex flex-wrap items-end gap-2 text-[13px]">
        <input name="q" defaultValue={query.q} placeholder="Name" className="h-9 w-56 rounded-lg border border-line-strong bg-paper px-2.5" />
        <input name="country" defaultValue={query.country} placeholder="Country" className="h-9 w-40 rounded-lg border border-line-strong bg-paper px-2.5" />
        <label className="flex h-9 items-center gap-1.5 text-ink-600">
          <input type="checkbox" name="all" value="1" defaultChecked={query.all === '1'} /> Include hidden
        </label>
        <button className="h-9 rounded-lg bg-ink-900 px-3 font-medium text-paper">Search</button>
      </form>
      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <EmptyState title="No institutions yet" description="Add the universities and colleges you work with - then choose them on applications and record what they pay you." />
        ) : (
          <MoneyTable head={['Institution', 'Country', 'Agreement', { label: 'Applications', right: true }, ...(money ? [{ label: 'Commission due', right: true }, { label: 'Received this year', right: true }] : [])]}>
            {list.map((i) => (
              <tr key={i.id} className={cx('border-t border-line hover:bg-ink-50/60', !i.active && 'opacity-60')}>
                <td className="px-4 py-2.5">
                  <Link href={`${base}/${i.id}`} className="font-medium text-ink-950 hover:text-brand-700">
                    {i.name}
                  </Link>
                  <span className="block text-[11.5px] text-ink-400">
                    {INSTITUTION_TYPE_LABEL[i.type]}
                    {i.aggregator ? ` · via ${i.aggregator}` : ''}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-700">
                  {i.country}
                  {i.city ? `, ${i.city}` : ''}
                </td>
                <td className="px-4 py-2.5">{i.activeAgreement ? <Pill tone="ok">{i.activeAgreement.validTo ? `Until ${formatDate(i.activeAgreement.validTo)}` : 'In force'}</Pill> : <Pill tone="neutral">None</Pill>}</td>
                <td className="tnum px-4 py-2.5 text-right text-ink-700">
                  {i.openApplications} open · {i.applications}
                </td>
                {money && <td className="tnum px-4 py-2.5 text-right font-medium">{i.outstanding ? formatMoney(i.outstanding, i.currency) : '–'}</td>}
                {money && <td className="tnum px-4 py-2.5 text-right text-ok-700">{i.receivedThisYear ? formatMoney(i.receivedThisYear, i.currency) : '–'}</td>}
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
    </>
  );
}

export async function NewInstitutionPage({ user }: { user: AuthUser }) {
  const base = universitiesBase(user);
  return (
    <>
      <PageHeader title="Add an institution" breadcrumb={[{ href: base, label: 'Universities' }, { label: 'New' }]} />
      <InstitutionForm initial={null} base={base} canEdit={can(user, 'institution.manage')} />
    </>
  );
}

export async function InstitutionPage({ user, id }: { user: AuthUser; id: string }) {
  const base = universitiesBase(user);
  let inst: InstitutionView;
  try {
    inst = await apiFetch<InstitutionView>(`/institutions/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const manage = can(user, 'institution.manage');
  const money = can(user, 'commission.view');
  const recent = money ? await apiFetch<Paginated<CommissionView>>(`/commissions${qs({ institutionId: id, pageSize: 10 })}`) : null;
  return (
    <>
      <PageHeader
        title={inst.name}
        subtitle={[INSTITUTION_TYPE_LABEL[inst.type], `${inst.country}${inst.city ? `, ${inst.city}` : ''}`, `pays in ${inst.currency}`, `${inst.openApplications} open applications`].join(' · ')}
        breadcrumb={[{ href: base, label: 'Universities' }, { label: inst.name }]}
        actions={
          money ? (
            <LinkButton href={`${commissionsBase(user)}/list${qs({ institutionId: id })}`} variant="secondary">
              Commissions
            </LinkButton>
          ) : undefined
        }
      />
      {(money || manage) && (
        <Panel
          title="Agreements"
          subtitle="What the institution pays, on which students, and when"
          className="mb-5"
          action={manage ? <AgreementEditor institutionId={inst.id} currency={inst.currency} agreement={null} /> : undefined}
        >
          {inst.agreements.length === 0 ? (
            <p className="text-[13px] text-ink-400">No agreement yet. Without one, commission is not worked out automatically (it can still be added by hand).</p>
          ) : (
            <div className="space-y-4">
              {inst.agreements.map((a) => (
                <div key={a.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[14.5px] font-medium text-ink-950">
                        {a.title} <span className="text-[12px] font-normal text-ink-400">v{a.version}</span>
                      </p>
                      <p className="text-[12.5px] text-ink-500">
                        {formatDate(a.validFrom)} to {a.validTo ? formatDate(a.validTo) : 'open-ended'} · {a.currency} · claim {a.claimAfterDays} days after start, paid within {a.paymentTermsDays} days · {a.confirmedStudents} students confirmed
                      </p>
                    </div>
                    <Pill tone={a.status === 'active' ? 'ok' : a.status === 'upcoming' ? 'info' : 'neutral'}>{AGREEMENT_STATUS_LABEL[a.status]}</Pill>
                  </div>
                  <ol className="mt-3 space-y-1.5 text-[13px]">
                    {a.rules.map((r, n) => (
                      <li key={r.id} className="text-ink-700">
                        <span className="text-ink-400">{n + 1}.</span> <span className="font-medium text-ink-900">{r.name}:</span>{' '}
                        {r.basis === 'percent' ? `${r.ratePercent}% of tuition` : formatMoney(Math.round(r.fixedAmount * 100), a.currency)}
                        {r.years === 'each_year' ? `, each year for ${r.yearCount} years` : ', first year'}
                        {r.tiers.length > 0 && `; ${r.tiers.map((t) => `${t.ratePercent}% from ${t.fromStudents} students`).join(', ')}`}
                        {r.bonusStudents && r.bonusAmount ? `; bonus ${formatMoney(Math.round(r.bonusAmount * 100), a.currency)} at ${r.bonusStudents} students` : ''}
                        {r.retentionDays ? `; clawed back if they leave within ${r.retentionDays} days` : ''}
                        <span className="text-ink-400">
                          {' '}
                          · expected at {STAGE_DEFINITIONS[r.triggerStage].label}
                          {r.conditions.length > 0 && ` · only when ${r.conditions.map(describeCondition).join(' and ').toLowerCase()}`}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {a.hasDocument && (
                      <a href={`/api/institutions/agreements/${a.id}/document`} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-brand-700 hover:underline">
                        Signed copy ({a.documentName}) ↗
                      </a>
                    )}
                    {manage && <AgreementDocument agreementId={a.id} />}
                    {manage && <AgreementEditor institutionId={inst.id} currency={inst.currency} agreement={a} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
      {recent && recent.items.length > 0 && (
        <Panel title="Latest commissions" className="mb-5" bodyClassName="">
          <MoneyTable head={['Student', 'Year', 'Stage', { label: 'Amount', right: true }]}>
            {recent.items.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-4 py-2.5">
                  <Link href={`${commissionsBase(user)}/${c.id}`} className="text-ink-900 hover:text-brand-700">
                    {c.kind === 'bonus' ? 'Volume bonus' : (c.clientName ?? c.number)}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-ink-500">{c.intake ?? '-'}{c.kind === 'student' ? ` · year ${c.yearNo}` : ''}</td>
                <td className="px-4 py-2.5">
                  <Pill tone={COMMISSION_STAGE_TONE[c.stage]}>{COMMISSION_STAGE_LABEL[c.stage]}</Pill>
                </td>
                <td className="tnum px-4 py-2.5 text-right">{formatMoney(c.amount, c.currency)}</td>
              </tr>
            ))}
          </MoneyTable>
        </Panel>
      )}
      <InstitutionForm initial={inst} base={base} canEdit={manage} />
    </>
  );
}
