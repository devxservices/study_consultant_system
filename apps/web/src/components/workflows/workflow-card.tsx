'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CaseWorkflowView, WorkflowDetailView, WorkflowSummaryView } from '@crm/shared';
import { Button, Card } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextArea } from '../forms';
import { Modal } from '../modal';

/**
 * Which workflow an application runs on, and the way to move it to another
 * one - or to the newer version of its own. A published version never
 * changes under an application, so moving is always a decision someone
 * makes, with a reason, and it is in the history.
 */
export function WorkflowCard({
  caseId,
  workflow,
  canChange,
  base,
}: {
  caseId: string;
  workflow: CaseWorkflowView;
  canChange: boolean;
  base: '/desk' | '/overview';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<WorkflowSummaryView[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [stages, setStages] = useState<WorkflowDetailView['currentStages']>(null);
  const [stageKey, setStageKey] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(preselect?: string) {
    setOpen(true);
    setError(null);
    setReason('');
    setStageKey('');
    if (!options) {
      const res = await callApi<WorkflowSummaryView[]>('/api/workflows', { method: 'GET' });
      if (res.ok && res.data) setOptions(res.data.filter((w) => w.current));
      else setError(res.message ?? 'Could not load the workflows.');
    }
    if (preselect) await pick(preselect);
  }

  async function pick(id: string) {
    setTemplateId(id);
    setStageKey('');
    setStages(null);
    if (!id) return;
    const res = await callApi<WorkflowDetailView>(`/api/workflows/${id}`, { method: 'GET' });
    if (res.ok && res.data) setStages(res.data.currentStages);
  }

  async function submit() {
    const target = options?.find((o) => o.id === templateId);
    if (!target?.current) return;
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/cases/${caseId}/workflow`, {
      method: 'POST',
      json: { versionId: target.current.versionId, stageKey: stageKey || undefined, reason: reason.trim() },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors.reason ?? res.message ?? 'Could not move it.');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const current = options?.find((o) => o.id === templateId);
  const sameVersion = current?.current?.versionId === workflow.versionId;

  return (
    <Card className="p-4">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">Workflow</p>
      <p className="mt-1 text-[14.5px] font-medium text-ink-950">
        <Link href={`${base}/workflows/${workflow.templateId}`} className="hover:text-brand-700">
          {workflow.templateName}
        </Link>
        <span className="ml-1.5 text-[12.5px] font-normal text-ink-400">version {workflow.version}</span>
      </p>
      {workflow.newerVersion && (
        <div className="mt-2 rounded-lg bg-info-50 px-3 py-2 text-[12.5px] text-info-700">
          Version {workflow.newerVersion.version} of this workflow has been published since this application started.
          {canChange && (
            <button type="button" className="ml-1 font-medium underline" onClick={() => start(workflow.templateId)}>
              Move it to version {workflow.newerVersion.version}
            </button>
          )}
        </div>
      )}
      {canChange && (
        <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={() => start()}>
          Change workflow
        </Button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Move to another workflow" description="It keeps its place where it can: the same stage, or the first one of the same kind.">
        <div className="space-y-3">
          {error && <FormAlert>{error}</FormAlert>}
          <Field label="Workflow" htmlFor="wf-target">
            <SelectInput
              id="wf-target"
              value={templateId}
              onChange={(v) => void pick(v)}
              placeholder={options ? 'Choose a workflow' : 'Loading…'}
              options={(options ?? []).map((o) => ({
                value: o.id,
                label: `${o.name}${o.country ? ` (${o.country})` : ''} · v${o.current?.version}`,
              }))}
            />
          </Field>
          {stages && (
            <Field label="Land on" htmlFor="wf-stage" hint="Leave as it is to keep its place.">
              <SelectInput
                id="wf-stage"
                value={stageKey}
                onChange={setStageKey}
                placeholder="Keep its place"
                options={stages.map((s) => ({ value: s.key, label: s.name }))}
              />
            </Field>
          )}
          <Field label="Reason" required hint="Saved in the application’s history.">
            <TextArea value={reason} onChange={setReason} rows={2} placeholder="e.g. The student switched to a college route" />
          </Field>
          {sameVersion && <p className="text-[12.5px] text-ink-500">It is already on this version.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !current || sameVersion || reason.trim().length < 5}>
              {busy ? 'Moving…' : 'Move application'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
