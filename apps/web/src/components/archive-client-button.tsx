'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cx } from './ui';

/**
 * Manager control to remove (archive) a client or restore an archived one.
 *
 * Removal is a soft archive, never a hard delete: the record, its cases and its
 * document audit trail all survive, only the client drops out of the active
 * lists. That is the right default for a system of record - a passport dispute
 * six months later still has to be answerable from the data.
 */
export function ArchiveClientButton({
  clientId,
  archived,
  name,
  redirectTo = '/overview/clients',
}: {
  clientId: string;
  archived: boolean;
  name: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!archived) {
      const ok = window.confirm(
        `Remove ${name}? Their record and history are kept, but they drop out of the active client lists. You can restore them later.`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = archived
        ? await fetch(`/api/clients/${clientId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived: false }),
          })
        : await fetch(`/api/clients/${clientId}/archive`, { method: 'POST' });

      if (!res.ok) {
        setError('That did not work. Please try again.');
        setBusy(false);
        return;
      }
      if (archived) {
        router.refresh();
        setBusy(false);
      } else {
        router.push(redirectTo);
        router.refresh();
      }
    } catch {
      setError('Cannot reach the server. Check your connection.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={cx(
          'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:opacity-50',
          archived
            ? 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'
            : 'border-bad-200 bg-bad-50 text-bad-700 hover:bg-bad-100',
        )}
      >
        {busy ? 'Working…' : archived ? 'Restore client' : 'Remove client'}
      </button>
      {error && <p className="text-[12px] text-bad-700">{error}</p>}
    </div>
  );
}
