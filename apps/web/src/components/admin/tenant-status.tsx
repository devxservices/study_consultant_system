'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TENANT_STATUS_LABEL, type TenantDetail, type TenantStatus } from '@crm/shared';
import { formatDate } from '@/lib/format';
import { Button, Card, Pill } from '../ui';
import { STATUS_TONE } from './status';
import { callApi, Field, FormAlert } from './form';

const EXPLAIN: Record<Exclude<TenantStatus, 'active'>, string> = {
  suspended:
    'A pause - an unpaid invoice, a dispute. Everyone at the consultancy is signed out on their next click and cannot sign in until it is reactivated.',
  deactivated:
    'The account is closed. Same lock-out as a suspension; use it when they have left the platform.',
};

/**
 * Taking a consultancy offline. Both options lock everyone out immediately and
 * delete nothing: reactivating puts them back exactly where they were.
 */
export function TenantStatusCard({ tenant }: { tenant: TenantDetail }) {
  const router = useRouter();
  const [target, setTarget] = useState<Exclude<TenantStatus, 'active'> | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(status: TenantStatus) {
    setError(null);
    setBusy(true);
    const res = await callApi<TenantDetail>(`/api/admin/tenants/${tenant.id}/status`, {
      method: 'POST',
      json: { status, reason: reason.trim() || undefined },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors.reason ?? res.message);
      return;
    }
    setTarget(null);
    setReason('');
    router.refresh();
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink-950">Status</h2>
        <Pill tone={STATUS_TONE[tenant.status]} dot>
          {TENANT_STATUS_LABEL[tenant.status]}
        </Pill>
      </div>

      {tenant.status === 'active' ? (
        <p className="mt-2 text-[13px] text-ink-500">
          Live. Staff and clients can sign in at every address above.
        </p>
      ) : (
        <div className="mt-3 rounded-md bg-ink-50 p-3 text-[13px] text-ink-600">
          <p>
            {TENANT_STATUS_LABEL[tenant.status]}
            {tenant.statusChangedAt ? ` on ${formatDate(tenant.statusChangedAt)}` : ''}. Nobody at the
            consultancy can sign in; their records are untouched.
          </p>
          {tenant.statusReason && (
            <p className="mt-1.5 text-ink-500">
              <span className="font-medium text-ink-700">Reason:</span> {tenant.statusReason}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3">
          <FormAlert>{error}</FormAlert>
        </div>
      )}

      {target ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <p className="text-[13px] text-ink-600">{EXPLAIN[target]}</p>
          <Field label="Reason" required hint="Kept for whoever reactivates it. Not shown to the consultancy.">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-300 focus:border-brand-500"
              placeholder="e.g. Invoice for September unpaid after two reminders"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => change(target)} disabled={busy}>
              {busy ? 'Working…' : target === 'suspended' ? 'Suspend now' : 'Deactivate now'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {tenant.status === 'active' ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setTarget('suspended')}>
                Suspend
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setTarget('deactivated')}>
                Deactivate
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => change('active')} disabled={busy}>
              {busy ? 'Working…' : 'Reactivate'}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
