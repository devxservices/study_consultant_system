import { STAGE_DEFINITIONS, STAGE_ORDER, applicableStages, type CaseStageView, type Stage } from '@crm/shared';
import { cx, Pill, type Tone } from './ui';

/**
 * A stage chip carries two pieces of information at once: which step, and how
 * far through the pipeline that is. The bar is what makes a list of 50 clients
 * scannable without reading a single label.
 */
export function StageChip({
  stage,
  country,
  name,
  showProgress = true,
  className,
}: {
  stage: Stage;
  country?: string | null;
  /** The stage's name in the application's own workflow; the bar still shows the overall journey. */
  name?: string | null;
  showProgress?: boolean;
  className?: string;
}) {
  const applicable = applicableStages(country);
  const index = applicable.indexOf(stage);
  const total = applicable.length;
  const position = index < 0 ? 0 : index + 1;
  const def = STAGE_DEFINITIONS[stage];
  const done = stage === 'closed';

  return (
    <span className={cx('inline-flex min-w-0 items-center gap-2', className)}>
      {showProgress && (
        <span
          className="flex shrink-0 items-center gap-[2px]"
          aria-hidden
          title={`Step ${position} of ${total}`}
        >
          {applicable.map((s, i) => (
            <span
              key={s}
              className={cx(
                'h-3 w-[3px] rounded-full',
                i < position - 1 && (done ? 'bg-ok-500' : 'bg-brand-400'),
                i === position - 1 && (done ? 'bg-ok-600' : 'bg-brand-700'),
                i > position - 1 && 'bg-ink-200',
              )}
            />
          ))}
        </span>
      )}
      <span className="truncate text-[13px] font-medium text-ink-800">{name ?? def.label}</span>
    </span>
  );
}

/** Days-in-stage, coloured only when it has genuinely gone stale. */
export function StalenessPill({ stage, days, slaDays }: { stage: Stage; days: number; slaDays?: number | null }) {
  const threshold = slaDays ?? STAGE_DEFINITIONS[stage].stuckAfterDays;
  const overdue = days > threshold;
  const nearly = !overdue && days > threshold * 0.7;

  const tone: Tone = overdue ? 'bad' : nearly ? 'warn' : 'neutral';
  return (
    <Pill tone={tone} dot={overdue}>
      {days}d in stage
    </Pill>
  );
}

/**
 * The client-facing tracker. Vertical on a phone, which is where it will
 * actually be read, and every completed step keeps its date so the client can
 * see the case has been moving.
 */
export function PipelineTracker({
  currentStage,
  country,
  enteredAt,
  history,
  workflow,
}: {
  currentStage: Stage;
  country?: string | null;
  enteredAt?: string;
  /** When each step was first entered, by stage key. */
  history?: Partial<Record<string, string>>;
  /** The application's own stages; the ten standard ones if not given. */
  workflow?: { stages: CaseStageView[]; currentStageKey: string } | null;
}) {
  const steps = workflow
    ? workflow.stages
        .filter((s) => s.applies)
        .map((s) => ({ key: s.key, clientLabel: s.clientLabel, clientDescription: s.clientDescription }))
    : applicableStages(country).map((s) => ({ key: s as string, clientLabel: STAGE_DEFINITIONS[s].clientLabel, clientDescription: STAGE_DEFINITIONS[s].clientDescription }));
  const currentKey = workflow?.currentStageKey ?? currentStage;
  const stages = steps.map((s) => s.key);
  const currentIndex = stages.indexOf(currentKey);

  return (
    <ol className="relative">
      {stages.map((s, i) => {
        const def = steps[i]!;
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo';
        const last = i === stages.length - 1;
        const date = state === 'current' ? enteredAt : history?.[s];

        return (
          <li key={s} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Connector */}
            {!last && (
              <span
                className={cx(
                  'absolute left-[9px] top-6 bottom-1 w-[2px] rounded',
                  state === 'done' ? 'bg-ok-200' : 'bg-ink-100',
                )}
                aria-hidden
              />
            )}

            <span className="relative z-10 mt-0.5 shrink-0">
              {state === 'done' ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-ok-500 text-white">
                  <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden>
                    <path
                      d="M2.5 6.2l2.2 2.2 4.8-4.8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              ) : state === 'current' ? (
                <span className="flex size-5 items-center justify-center rounded-full border-2 border-brand-600 bg-paper">
                  <span className="size-2 rounded-full bg-brand-600" />
                </span>
              ) : (
                <span className="block size-5 rounded-full border-2 border-ink-200 bg-paper" />
              )}
            </span>

            <div className="min-w-0 flex-1 pt-px">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p
                  className={cx(
                    'text-[14px]',
                    state === 'current'
                      ? 'font-semibold text-ink-950'
                      : state === 'done'
                        ? 'font-medium text-ink-700'
                        : 'text-ink-400',
                  )}
                >
                  {def.clientLabel}
                </p>
                {date && (
                  <span className="text-[12px] text-ink-400">
                    {new Date(date).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                )}
              </div>
              {state === 'current' && (
                <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
                  {def.clientDescription}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { STAGE_ORDER };
