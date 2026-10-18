import { STAGE_DEFINITIONS, type Stage } from '@crm/shared';
import { Pill, cx } from './ui';

export interface StageHistoryEntry {
  id: string;
  stage: Stage;
  /** The stage in the workflow the application was on, when known. */
  stageKey?: string | null;
  stageName?: string | null;
  enteredAt: string;
  completedAt: string | null;
  method: 'auto' | 'manual' | 'initial';
  changedByName: string | null;
  note: string | null;
}

function duration(from: string, to: string | null): string {
  const end = to ? new Date(to).getTime() : Date.now();
  const days = Math.max(0, Math.round((end - new Date(from).getTime()) / 86_400_000));
  if (days === 0) return 'same day';
  if (days === 1) return '1 day';
  if (days < 60) return `${days} days`;
  return `${Math.round(days / 30)} months`;
}

const METHOD_LABEL: Record<StageHistoryEntry['method'], string> = {
  auto: 'Automatic',
  manual: 'Manual',
  initial: 'Case opened',
};

/**
 * The audit trail as a consultant or manager actually reads it: who moved this
 * case, when, whether the system did it or a person did, and why. This is what
 * settles an argument three months later.
 */
export function StageHistory({
  entries,
  labelFor,
}: {
  entries: StageHistoryEntry[];
  /** The words to name each stage in: staff see the stage name, the student the label written for them. */
  labelFor?: (e: StageHistoryEntry) => string;
}) {
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-ink-400">No history yet.</p>;
  }

  return (
    <ol className="divide-y divide-line">
      {entries.map((e) => {
        const open = !e.completedAt;
        return (
          <li key={e.id} className="flex gap-3 px-4 py-3">
            <span className="mt-1.5 shrink-0" aria-hidden>
              <span
                className={cx(
                  'block size-2 rounded-full',
                  open ? 'bg-brand-600 ring-4 ring-brand-100' : 'bg-ink-200',
                )}
              />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p
                  className={cx(
                    'text-[14px]',
                    open ? 'font-semibold text-ink-950' : 'font-medium text-ink-800',
                  )}
                >
                  {labelFor ? labelFor(e) : (e.stageName ?? STAGE_DEFINITIONS[e.stage].label)}
                </p>
                {open && <Pill tone="info">Current</Pill>}
                {e.method === 'auto' && <Pill tone="ok">Automatic</Pill>}
              </div>

              <p className="mt-0.5 text-[12px] text-ink-400">
                {new Date(e.enteredAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {' · '}
                {duration(e.enteredAt, e.completedAt)}
                {e.changedByName ? ` · ${e.method === 'auto' ? 'triggered by' : 'by'} ${e.changedByName}` : ''}
                {e.method === 'initial' ? ` · ${METHOD_LABEL.initial}` : ''}
              </p>

              {e.note && (
                <p className="mt-1.5 rounded-md border border-line bg-ink-50 px-2.5 py-1.5 text-[13px] leading-snug text-ink-600">
                  {e.note}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
