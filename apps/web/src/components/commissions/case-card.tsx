import Link from 'next/link';
import { COMMISSION_STAGE_LABEL, COMMISSION_STAGE_TONE, formatMoney, type AuthUser, type CommissionView, type InstitutionSummaryView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, Pill } from '../ui';
import { ActionButton } from '../forms';
import type { CaseDetail } from '../case-view';
import { commissionsBase, universitiesBase } from './institution-pages';
import { EnrolmentForm } from './commission-forms';

/**
 * The application's institution and the fees its commission is worked out
 * on, with the commission expected or earned on it. Everyone on the case
 * sees the institution; the money needs "See commissions".
 */
export async function CaseCommissionCard({ user, detail }: { user: AuthUser; detail: CaseDetail }) {
  const money = can(user, 'commission.view');
  const manage = can(user, 'commission.manage');
  const edit = can(user, 'case.edit');
  const [institutions, list] = await Promise.all([
    edit ? apiFetch<InstitutionSummaryView[]>('/institutions').catch(() => [] as InstitutionSummaryView[]) : Promise.resolve([] as InstitutionSummaryView[]),
    money ? apiFetch<CommissionView[]>(`/cases/${detail.id}/commissions`).catch(() => [] as CommissionView[]) : Promise.resolve([] as CommissionView[]),
  ]);
  const base = commissionsBase(user);
  const rows: [string, string][] = [
    ['Tuition', detail.tuitionFee ? formatMoney(detail.tuitionFee, detail.tuitionCurrency ?? 'GBP') : '–'],
    ['Scholarship', detail.scholarship ? formatMoney(detail.scholarship, detail.tuitionCurrency ?? 'GBP') : '–'],
    ['Course starts', detail.courseStart ? formatDate(detail.courseStart) : '–'],
  ];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[15.5px] font-medium text-ink-950">Institution and commission</h2>
        {edit && (
          <EnrolmentForm
            caseId={detail.id}
            institutions={institutions}
            initial={{
              institutionId: detail.institutionId ?? null,
              tuitionFee: detail.tuitionFee ?? null,
              tuitionCurrency: detail.tuitionCurrency ?? null,
              scholarship: detail.scholarship ?? null,
              courseStart: detail.courseStart ?? null,
            }}
          />
        )}
      </div>
      <p className="mt-2 text-[13.5px] text-ink-800">
        {detail.institutionId && detail.institutionName ? (
          <Link href={`${universitiesBase(user)}/${detail.institutionId}`} className="font-medium text-brand-700 hover:underline">
            {detail.institutionName}
          </Link>
        ) : (
          <span className="text-ink-500">{detail.targetUniversity ? `${detail.targetUniversity} (not linked to the catalogue)` : 'Not chosen yet'}</span>
        )}
      </p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-ink-400">{k}</dt>
            <dd className="tnum text-ink-800">{v}</dd>
          </div>
        ))}
      </dl>
      {money && (
        <div className="mt-3 border-t border-line pt-3">
          {list.length === 0 ? (
            <p className="text-[12.5px] text-ink-400">
              {detail.institutionId ? 'No commission yet. It is expected when the application reaches the step the agreement names.' : 'Link the institution to work out its commission.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {list.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <Link href={`${base}/${c.id}`} className="min-w-0 truncate text-ink-800 hover:text-brand-700">
                    {c.kind === 'bonus' ? 'Volume bonus' : `Year ${c.yearNo}`} · {formatMoney(c.amount, c.currency)}
                  </Link>
                  <Pill tone={COMMISSION_STAGE_TONE[c.stage]}>{COMMISSION_STAGE_LABEL[c.stage]}</Pill>
                </li>
              ))}
            </ul>
          )}
          {manage && detail.institutionId && (
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton url={`/api/cases/${detail.id}/commissions/work-out`} variant="ghost">
                {list.length ? 'Work out again' : 'Work it out now'}
              </ActionButton>
              <Link href={`${base}/new?caseId=${detail.id}`} className="inline-flex h-8 items-center text-[12.5px] font-medium text-brand-700 hover:underline">
                Add by hand
              </Link>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
