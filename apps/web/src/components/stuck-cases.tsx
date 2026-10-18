import Link from 'next/link';
import { STAGE_DEFINITIONS, type Stage } from '@crm/shared';
import { Pill, cx } from './ui';

export interface StuckCase {
  id: string;
  reference: string;
  clientId: string;
  clientName: string;
  consultantId: string | null;
  consultantName: string | null;
  targetCountry: string;
  currentStage: Stage;
  stageEnteredAt: string;
  daysInStage: number;
  daysOverdue: number;
  pendingDocuments: number;
}

/**
 * One stalled case, written so a manager can act without opening it: who it is,
 * where it is stuck, how far past the limit, and - crucially - whether the
 * hold-up is on our side (documents waiting to be reviewed) or the client's.
 */
export function StuckCaseRow({
  item,
  href,
  showConsultant = true,
}: {
  item: StuckCase;
  href: string;
  showConsultant?: boolean;
}) {
  const def = STAGE_DEFINITIONS[item.currentStage];
  // Anything at double its allowed time is a different order of problem.
  const severe = item.daysOverdue >= def.stuckAfterDays;

  return (
    <li>
      <Link href={href} className="block px-4 py-3 transition-colors hover:bg-bad-50/40">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-ink-950">{item.clientName}</p>
            <p className="mt-0.5 truncate text-[12px] text-ink-500">
              {def.label} · {item.targetCountry}
              {showConsultant && (
                <> · {item.consultantName ?? <span className="text-warn-700">unassigned</span>}</>
              )}
            </p>
          </div>
          <Pill tone={severe ? 'bad' : 'warn'} dot={severe}>
            {item.daysInStage}d in stage
          </Pill>
        </div>

        <p
          className={cx(
            'mt-1.5 text-[12px]',
            severe ? 'font-medium text-bad-700' : 'text-ink-500',
          )}
        >
          {item.daysOverdue}d past the {def.stuckAfterDays}-day limit for this stage
          {item.pendingDocuments > 0 ? (
            <span className="text-warn-700">
              {' '}
              · {item.pendingDocuments} document{item.pendingDocuments === 1 ? '' : 's'} waiting on
              us
            </span>
          ) : null}
        </p>
      </Link>
    </li>
  );
}
