'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { RoleTemplateView } from '@crm/shared';
import { Button } from '../ui';
import { callApi, FormAlert, SelectInput } from '../forms';

/**
 * Gives a member of staff one of the consultancy's roles. Their permissions
 * follow it from their next click; their own Allow/Deny below still wins.
 */
export function RoleAssigner({
  userId,
  name,
  roles,
  current,
}: {
  userId: string;
  name: string;
  roles: RoleTemplateView[];
  current: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const chosen = roles.find((r) => r.id === value);

  async function save() {
    setBusy(true);
    setNote(null);
    const res = await callApi(`/api/team/${userId}/role`, { method: 'PUT', json: { roleId: value || null } });
    setBusy(false);
    if (!res.ok) {
      setNote({ tone: 'bad', text: res.message ?? 'The role could not be changed.' });
      return;
    }
    setNote({ tone: 'ok', text: `Saved. ${name.split(' ')[0]} has the new access from their next click.` });
    router.refresh();
  }

  return (
    <section className="rounded-xl bg-paper p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="role" className="text-[13px] font-medium text-ink-800">
            Role
          </label>
          <p className="text-[12.5px] text-ink-500">
            {chosen?.description ?? 'No role: the consultancy’s defaults for consultants apply.'}
          </p>
          <div className="mt-2 max-w-sm">
            <SelectInput
              id="role"
              value={value}
              onChange={setValue}
              options={[{ value: '', label: 'No role - consultancy defaults' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]}
            />
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={busy || value === (current ?? '')}>
          {busy ? 'Saving…' : 'Save role'}
        </Button>
      </div>
      {chosen && !chosen.takesClients && (
        <p className="mt-2 text-[12.5px] text-warn-700">
          This role has no caseload: {name.split(' ')[0]} will not be offered when students are assigned.
        </p>
      )}
      {note && (
        <div className="mt-3">
          <FormAlert tone={note.tone}>{note.text}</FormAlert>
        </div>
      )}
    </section>
  );
}
