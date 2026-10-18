'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { callApi } from '@/components/forms';

export function TestCheckout({ id, invoiceId, status }: { id: string; invoiceId: string; status: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = (q: string) => `/portal/payments/invoices/${invoiceId}?${q}=${id}`;
  if (status !== 'created') {
    return (
      <p className="mt-5 text-[13.5px] text-ink-600">
        This payment is {status}.{' '}
        <a href={`/portal/payments/invoices/${invoiceId}`} className="text-brand-700 hover:underline">
          Back to the invoice
        </a>
      </p>
    );
  }
  async function decide(pay: boolean) {
    setBusy(true);
    setError(null);
    const res = await callApi(`/api/billing/online/${id}/test`, { method: 'POST', json: { pay } });
    if (!res.ok) {
      setBusy(false);
      setError(res.message ?? 'That did not work.');
      return;
    }
    window.location.href = back(pay ? 'paid' : 'cancelled');
  }
  return (
    <div className="mt-6 space-y-2">
      <Button className="w-full" disabled={busy} onClick={() => decide(true)}>
        Pay
      </Button>
      <Button className="w-full" variant="secondary" disabled={busy} onClick={() => decide(false)}>
        Cancel
      </Button>
      {error && <p className="text-[12.5px] text-bad-700">{error}</p>}
    </div>
  );
}
