'use client';

import { useState } from 'react';
import type { PasswordLinkResult } from '@crm/shared';
import { Button } from '../ui';
import { callApi } from '../forms';
import { SentLink } from '../password-link';

/** A consultancy's manager who cannot get in: email them a link to choose a password. */
export function ManagerLinkButton({ tenantId, manager }: { tenantId: string; manager: { id: string; fullName: string; email: string } }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<PasswordLinkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const res = await callApi<PasswordLinkResult>(`/api/admin/tenants/${tenantId}/managers/${manager.id}/password-link`, { method: 'POST' });
    setBusy(false);
    if (!res.ok || !res.data) setError(res.message ?? 'That did not work.');
    else setSent(res.data);
  }

  return (
    <div className="w-full">
      {!sent && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={send}>
          {busy ? 'Sending…' : 'Send a password link'}
        </Button>
      )}
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
      {sent && <SentLink result={sent} email={manager.email} name={manager.fullName} />}
    </div>
  );
}
