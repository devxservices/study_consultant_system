'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MFA_POLICIES, MFA_POLICY_LABEL, type MfaPolicy } from '@crm/shared';
import { Button, cx } from '../ui';
import { callApi, FormAlert } from '../forms';

const DESCRIPTION: Record<MfaPolicy, string> = {
  optional: 'Anyone can switch it on for their own account. Nobody is made to.',
  staff:
    'Managers and consultants must use it. Anyone who has not set it up is asked to before they can do anything else.',
  everyone:
    'Staff and clients must use it. The strongest setting, and a little more for clients to set up on their phone.',
};

/** Who has to use two-step verification in this consultancy. */
export function MfaPolicyForm({
  initial,
  withoutTwoStep,
  ownEnabled,
  accountHref,
}: {
  initial: MfaPolicy;
  withoutTwoStep: number;
  /** Whether the manager saving this uses it themselves - required before requiring it of others. */
  ownEnabled: boolean;
  accountHref: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    const res = await callApi<{ policy: MfaPolicy }>('/api/team/security', { method: 'PUT', json: { policy: value } });
    setBusy(false);
    if (!res.ok) {
      setNote({ tone: 'bad', text: res.message ?? 'That could not be saved.' });
      return;
    }
    setSaved(value);
    setNote({
      tone: 'ok',
      text:
        value === 'optional'
          ? 'Saved. Two-step verification is now optional.'
          : 'Saved. Anyone this now covers who has not set it up will be asked to on their next click.',
    });
    router.refresh();
  }

  const tightening = value !== 'optional' && value !== saved && withoutTwoStep > 0;

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Two-step verification policy" className="grid gap-2 lg:grid-cols-3">
        {MFA_POLICIES.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value === p}
            disabled={p !== 'optional' && !ownEnabled && saved !== p}
            onClick={() => setValue(p)}
            className={cx(
              'rounded-xl border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55',
              value === p ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-line hover:border-line-strong',
            )}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={cx(
                  'flex size-4 items-center justify-center rounded-full border-2',
                  value === p ? 'border-brand-600' : 'border-ink-300',
                )}
              >
                {value === p && <span className="size-1.5 rounded-full bg-brand-600" />}
              </span>
              <span className="text-[14px] font-medium text-ink-950">{MFA_POLICY_LABEL[p]}</span>
              {saved === p && <span className="ml-auto text-[11.5px] font-medium text-ink-400">Current</span>}
            </span>
            <span className="mt-1.5 block text-[12.5px] leading-snug text-ink-500">{DESCRIPTION[p]}</span>
          </button>
        ))}
      </div>

      {!ownEnabled && (
        <p className="rounded-lg border border-line bg-ink-50 px-3 py-2 text-[13px] text-ink-600">
          To require it of others, first{' '}
          <a href={accountHref} className="font-medium text-brand-700 hover:underline">
            turn it on for your own account
          </a>
          . That way saving the policy can never lock you out.
        </p>
      )}
      {tightening && (
        <p className="rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-[13px] text-warn-700">
          {withoutTwoStep} {withoutTwoStep === 1 ? 'member of staff has' : 'members of staff have'} not set it up yet.
          They will be asked to the moment this is saved - make sure they have their phone to hand.
        </p>
      )}
      {note && <FormAlert tone={note.tone}>{note.text}</FormAlert>}

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy || value === saved}>
          {busy ? 'Saving…' : 'Save policy'}
        </Button>
      </div>
    </div>
  );
}
