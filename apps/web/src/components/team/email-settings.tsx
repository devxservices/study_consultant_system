'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NOTIFICATION_TYPE_LABEL, NOTIFICATION_TYPES, type NotificationType } from '@crm/shared';
import { Button } from '../ui';
import { callApi, FormAlert } from '../forms';

const GROUPS: { label: string; types: NotificationType[] }[] = [
  {
    label: 'Students and applications',
    types: ['stage_changed', 'document_verified', 'document_rejected', 'document_commented', 'document_status', 'document_uploaded', 'document_expiring', 'message_received', 'case_stuck', 'client_assigned'],
  },
  {
    label: 'Money',
    types: ['invoice_issued', 'payment_received', 'installment_due', 'payment_overdue', 'payment_submitted', 'payment_reviewed', 'refund_requested', 'refund_decided', 'approval_needed'],
  },
  { label: 'Commissions and partners', types: ['commission_due', 'claim_follow_up', 'partner_applied', 'partner_update', 'payout_ready', 'attribution_conflict'] },
  { label: 'Courses', types: ['course_update', 'absence_alert', 'homework_update'] },
  { label: 'Team', types: ['task_assigned', 'task_overdue', 'announcement'] },
];

/**
 * Which notifications also go out by email. Every one always appears in the
 * bell; this decides only whether the person is emailed too - from the
 * consultancy's name, with a link back to it.
 */
export function EmailSettings({ initial }: { initial: Record<string, boolean> }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const dirty = NOTIFICATION_TYPES.some((t) => values[t] !== saved[t]);

  async function save() {
    setBusy(true);
    setNote(null);
    const res = await callApi<Record<string, boolean>>('/api/team/email-notifications', {
      method: 'PUT',
      json: { settings: values },
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setNote({ tone: 'bad', text: res.message ?? 'Could not save.' });
      return;
    }
    setSaved(res.data);
    setValues(res.data);
    setNote({ tone: 'ok', text: 'Saved.' });
    router.refresh();
  }

  return (
    <div className="rounded-xl bg-paper p-4 shadow-card sm:p-5">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {GROUPS.map((g) => (
          <fieldset key={g.label}>
            <legend className="text-[13px] font-semibold text-ink-900">{g.label}</legend>
            <ul className="mt-2 space-y-1.5">
              {g.types.map((t) => (
                <li key={t}>
                  <label className="flex items-start gap-2 text-[13px] text-ink-700">
                    <input
                      type="checkbox"
                      checked={values[t] !== false}
                      onChange={(e) => setValues((v) => ({ ...v, [t]: e.target.checked }))}
                      className="mt-0.5 size-4 accent-brand-700"
                    />
                    {NOTIFICATION_TYPE_LABEL[t]}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
      {note && (
        <div className="mt-4">
          <FormAlert tone={note.tone}>{note.text}</FormAlert>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save email settings'}
        </Button>
      </div>
    </div>
  );
}
