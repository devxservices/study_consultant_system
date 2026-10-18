import { PageStamp } from '@/components/page-stamp';
import { Card, EmptyState, Pill, cx } from '@/components/ui';
import { STAGE_DEFINITIONS } from '@crm/shared';
import { PipelineTracker } from '@/components/stage';
import { StageHistory } from '@/components/stage-history';
import { formatDate } from '@/lib/format';
import { currentStep, getPortalClient, getPortalCase, historyDates } from '@/lib/portal';

export const metadata = { title: 'Your progress' };

export default async function PortalProgressPage() {
  const { firstCase } = await getPortalClient();
  if (!firstCase) {
    return (
      <Card>
        <EmptyState
          title="No application open yet"
          description="Once your consultant opens your application, every step will show here."
        />
      </Card>
    );
  }

  const detail = await getPortalCase(firstCase.id);
  const def = currentStep(detail);
  const isDone = detail.currentStage === 'closed';

  return (
    <div className="space-y-5">
      <PageStamp />
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink-950">Your progress</h1>
        <p className="mt-0.5 text-[14px] text-ink-500">
          Every step of your application, from first inquiry to decision.
        </p>
      </div>

      <section
        className={cx(
          'rounded-2xl border p-5 shadow-card',
          isDone ? 'border-ok-200 bg-ok-50' : 'border-line bg-paper',
        )}
      >
        <p className={cx('text-[13px]', isDone ? 'text-ok-700' : 'text-ink-500')}>
          You are currently at
        </p>
        <h2
          className={cx(
            'mt-0.5 text-[20px] font-semibold leading-7 tracking-[-0.01em]',
            isDone ? 'text-ok-700' : 'text-ink-950',
          )}
        >
          {def.clientLabel}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone="info">{detail.targetUniversity ?? detail.targetCountry}</Pill>
          {detail.intake && <Pill tone="neutral">{detail.intake}</Pill>}
          <span className="text-[12px] text-ink-400">Since {formatDate(detail.stageEnteredAt)}</span>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-paper p-4 shadow-card sm:p-5">
        <h3 className="mb-3 text-[15px] font-semibold text-ink-950">The stages</h3>
        <PipelineTracker
          currentStage={detail.currentStage}
          country={detail.targetCountry}
          enteredAt={detail.stageEnteredAt}
          history={historyDates(detail.history)}
          workflow={detail.workflow}
        />
      </section>

      <section className="rounded-xl border border-line bg-paper p-4 shadow-card sm:p-5">
        <h3 className="mb-3 text-[15px] font-semibold text-ink-950">History</h3>
        <StageHistory
          entries={detail.history}
          labelFor={(e) =>
            detail.workflow?.stages.find((s) => s.key === e.stageKey)?.clientLabel ?? STAGE_DEFINITIONS[e.stage].clientLabel
          }
        />
      </section>
    </div>
  );
}
