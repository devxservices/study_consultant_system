'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CASE_STATUSES,
  CASE_STATUS_LABEL,
  checkCaseStageTransition,
  nextCaseStageKey,
  type CaseStageView,
  type CaseStatus,
  type CaseWorkflowView,
} from '@crm/shared';
import { Button, Pill, cx } from './ui';
import { callApi } from './forms';

/**
 * Moving a case is the one destructive-feeling action a consultant takes daily.
 * The design goal is that the common move (one step forward) is a single click,
 * while anything unusual - going back, skipping ahead - is still possible but
 * asks for a reason first and says plainly what it is about to do.
 *
 * The stages are the application's own workflow's. Two gates a workflow can
 * set are shown before anyone tries: a stage that must be signed off before
 * it moves on, and a stage only managers may move applications into or out of.
 */
export function StageControl({
  caseId,
  workflow,
  targetCountry,
  status,
  checklistSatisfied,
  checklistSummary,
  canApprove,
}: {
  caseId: string;
  workflow: CaseWorkflowView;
  targetCountry: string;
  status: CaseStatus;
  checklistSatisfied: boolean;
  checklistSummary: string;
  /** Managers, or staff with "approve gated stages". */
  canApprove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stages = workflow.stages;
  const current = stages.find((s) => s.key === workflow.currentStageKey);
  const nextKey = nextCaseStageKey(stages, workflow.currentStageKey);
  const next = stages.find((s) => s.key === nextKey);
  const options = stages.filter((s) => s.applies && s.key !== workflow.currentStageKey);
  const check = target ? checkCaseStageTransition(stages, workflow.currentStageKey, target, targetCountry) : null;
  const isActive = status === 'active';
  const awaitingApproval = workflow.approval.required && !workflow.approval.approvedAt;

  /** Why this person cannot make this move, if they cannot. */
  function blocked(to: CaseStageView | undefined, kind: string | undefined): string | null {
    if (!to) return null;
    if (!canApprove && current?.movableBy === 'managers') return `Only managers move applications out of “${current.name}”.`;
    if (!canApprove && to.movableBy === 'managers') return `Only managers move applications into “${to.name}”.`;
    if (awaitingApproval && kind !== 'back' && !canApprove) return `“${current?.name}” needs a manager’s approval first.`;
    return null;
  }

  async function move(stageKey: string, why?: string) {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/cases/${caseId}/stage`, { method: 'POST', json: { stageKey, reason: why?.trim() || undefined } });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors.reason ?? res.message ?? 'Could not move the case.');
      return;
    }
    setOpen(false);
    setTarget('');
    setReason('');
    router.refresh();
  }

  async function approve() {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/cases/${caseId}/approve`, { method: 'POST', json: {} });
    setBusy(false);
    if (!res.ok) setError(res.message ?? 'Could not approve.');
    else router.refresh();
  }

  async function setStatus(newStatus: CaseStatus) {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/cases/${caseId}/status`, { method: 'POST', json: { status: newStatus } });
    if (!res.ok) setError(res.message ?? 'Could not change the status.');
    setBusy(false);
    router.refresh();
  }

  const nextBlocked = blocked(next, 'next');
  const targetBlocked = check ? blocked(stages.find((s) => s.key === target), check.kind) : null;

  return (
    <div className="rounded-xl border border-line bg-paper shadow-card">
      <div className="border-b border-line p-4">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Current stage</p>
        <p className="mt-1 text-[17px] font-semibold text-ink-950">{current?.name ?? '—'}</p>
        <p className="mt-1 text-[13px] text-ink-500">
          {checklistSummary}
          {checklistSatisfied && !awaitingApproval && <span className="ml-1.5 font-medium text-ok-700">Ready to move on.</span>}
        </p>
        {current?.movableBy === 'managers' && (
          <p className="mt-1.5 text-[12px] text-ink-400">Only managers move applications into or out of this stage.</p>
        )}
      </div>

      {workflow.approval.required && (
        <div className={cx('border-b px-4 py-3 text-[13px]', awaitingApproval ? 'border-warn-200 bg-warn-50 text-warn-700' : 'border-ok-200 bg-ok-50 text-ok-700')}>
          {awaitingApproval ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>This stage needs sign-off before the application moves on.</span>
              {canApprove && isActive && (
                <Button size="sm" onClick={approve} disabled={busy}>
                  Approve stage
                </Button>
              )}
            </div>
          ) : (
            <span>
              Approved{workflow.approval.approvedByName ? ` by ${workflow.approval.approvedByName}` : ''}
              {workflow.approval.approvedAt ? ` on ${new Date(workflow.approval.approvedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}.
            </span>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="border-b border-bad-200 bg-bad-50 px-4 py-2.5 text-[13px] text-bad-700">
          {error}
        </div>
      )}

      <div className="p-4">
        {!isActive ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-500">
              This case is <strong className="text-ink-800">{CASE_STATUS_LABEL[status]}</strong>. Set it back to active before
              moving it through the pipeline.
            </p>
            <Button variant="secondary" onClick={() => setStatus('active')} disabled={busy}>
              Reactivate case
            </Button>
          </div>
        ) : (
          <>
            {next ? (
              <>
                <Button onClick={() => move(next.key)} disabled={busy || Boolean(nextBlocked)} className="w-full">
                  {busy ? 'Moving...' : `Move to ${next.name}`}
                </Button>
                {nextBlocked && <p className="mt-1.5 text-[12px] text-ink-500">{nextBlocked}</p>}
              </>
            ) : (
              <p className="text-[13px] text-ink-500">This case is at the final stage.</p>
            )}

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-2 w-full rounded-md px-2 py-1.5 text-[13px] font-medium text-ink-500 hover:bg-ink-50 hover:text-ink-900"
            >
              {open ? 'Cancel' : 'Move somewhere else'}
            </button>

            {open && (
              <div className="mt-3 space-y-3 border-t border-line pt-3">
                <div>
                  <label htmlFor="stage-target" className="mb-1.5 block text-[13px] font-medium text-ink-800">
                    Move this case to
                  </label>
                  <select
                    id="stage-target"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="h-9 w-full rounded-md border border-line-strong bg-paper px-2.5 text-[14px] text-ink-900 focus:border-brand-500"
                  >
                    <option value="">Choose a stage</option>
                    {options.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {check && (
                  <div
                    className={cx(
                      'rounded-md border px-3 py-2 text-[13px]',
                      check.kind === 'back' || check.kind === 'skip'
                        ? 'border-warn-200 bg-warn-50 text-warn-700'
                        : 'border-brand-200 bg-brand-50 text-brand-700',
                    )}
                  >
                    {targetBlocked ?? check.message}
                  </div>
                )}

                {check?.requiresReason && !targetBlocked && (
                  <div>
                    <label htmlFor="stage-reason" className="mb-1.5 block text-[13px] font-medium text-ink-800">
                      Reason <span className="text-bad-600">*</span>
                    </label>
                    <textarea
                      id="stage-reason"
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why is the case moving this way?"
                      className="w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-300 focus:border-brand-500"
                    />
                    <p className="mt-1 text-[12px] text-ink-400">Saved permanently against the case history.</p>
                  </div>
                )}

                <Button
                  onClick={() => target && move(target, reason)}
                  disabled={busy || !target || Boolean(targetBlocked) || (check?.requiresReason === true && !reason.trim())}
                >
                  {busy ? 'Moving...' : 'Move case'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-line p-4">
        <label htmlFor="case-status" className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-ink-400">
          Case status
        </label>
        <div className="flex items-center gap-2">
          <select
            id="case-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as CaseStatus)}
            disabled={busy}
            className="h-9 flex-1 rounded-md border border-line-strong bg-paper px-2.5 text-[14px] text-ink-900 focus:border-brand-500"
          >
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CASE_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Pill tone={status === 'approved' ? 'ok' : status === 'rejected' ? 'bad' : status === 'active' ? 'info' : 'neutral'}>
            {CASE_STATUS_LABEL[status]}
          </Pill>
        </div>
      </div>
    </div>
  );
}
