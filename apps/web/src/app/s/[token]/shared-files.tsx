'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { PublicShareView } from '@crm/shared';
import { formatBytes, formatDate } from '@/lib/format';
import { Button, Card } from '@/components/ui';
import { FormAlert, TextInput } from '@/components/forms';
import { IconDownload, IconEye, IconFile, IconLock } from '@/components/icons';

/** The access token from a correct password lives only in this tab. */
const accessKey = (token: string) => `share-access:${token}`;

export function SharedFiles({ token }: { token: string }) {
  const [view, setView] = useState<PublicShareView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [access, setAccess] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(
    async (acc: string | null) => {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}${acc ? `?access=${encodeURIComponent(acc)}` : ''}`);
      const body = (await res.json().catch(() => null)) as (PublicShareView & { message?: string }) | null;
      if (!res.ok || !body) {
        setProblem(body?.message ?? 'This link does not work.');
        return;
      }
      setView(body);
    },
    [token],
  );

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(accessKey(token));
    } catch {
      /* private browsing */
    }
    setAccess(saved);
    void load(saved);
  }, [token, load]);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/share/${encodeURIComponent(token)}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const body = (await res.json().catch(() => null)) as { access?: string; message?: string } | null;
    setBusy(false);
    if (!res.ok || !body?.access) return setError(body?.message ?? 'That did not work.');
    try {
      sessionStorage.setItem(accessKey(token), body.access);
    } catch {
      /* keep it in memory only */
    }
    setAccess(body.access);
    void load(body.access);
  }

  const fileUrl = (id: string, download: boolean) =>
    `/api/share/${encodeURIComponent(token)}/files/${id}?${new URLSearchParams({ ...(access ? { access } : {}), ...(download ? { download: '1' } : {}) })}`;

  if (problem) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[16px] font-semibold text-ink-950">This link cannot be opened</p>
        <p className="mt-1 text-[14px] text-ink-500">{problem}</p>
      </Card>
    );
  }
  if (!view) return <p className="text-center text-[14px] text-ink-400">Opening…</p>;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-medium text-brand-700">{view.consultancy}</p>
        <h1 className="mt-0.5 text-[22px] font-semibold text-ink-950">{view.name}</h1>
        <p className="mt-1 text-[13.5px] text-ink-500">
          Shared with {view.label} · available until {formatDate(view.expiresAt)}
          {view.viewOnly ? ' · view only' : ''}
        </p>
      </div>

      {view.needsPassword ? (
        <Card className="p-5">
          <form onSubmit={unlock} className="space-y-3">
            <p className="flex items-center gap-2 text-[14px] font-medium text-ink-900">
              <IconLock size={17} className="text-ink-500" />
              Enter the password you were given
            </p>
            {error && <FormAlert>{error}</FormAlert>}
            <TextInput value={password} onChange={setPassword} type="password" autoComplete="off" />
            <Button type="submit" disabled={busy || !password}>
              {busy ? 'Checking…' : 'Open'}
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {(view.items ?? []).map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <IconFile size={20} className="shrink-0 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink-900">{i.fileName}</p>
                  <p className="text-[12px] text-ink-500">
                    {i.typeLabel} · {formatBytes(i.fileSize)}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setPreview(preview === i.id ? null : i.id)}>
                  <IconEye size={15} />
                  View
                </Button>
                {!view.viewOnly && (
                  <a href={fileUrl(i.id, true)} className="press inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-[13px] font-medium text-white">
                    <IconDownload size={15} />
                    Download
                  </a>
                )}
              </li>
            ))}
            {(view.items ?? []).length === 0 && <li className="px-4 py-8 text-center text-[13.5px] text-ink-500">Nothing in this folder.</li>}
          </ul>
          {preview && (
            <div className="border-t border-line bg-ink-50">
              {(() => {
                const item = view.items?.find((x) => x.id === preview);
                if (!item) return null;
                if (item.mimeType === 'application/pdf') return <iframe title={item.fileName} src={fileUrl(item.id, false)} className="h-[70vh] w-full" />;
                if (item.mimeType.startsWith('image/'))
                  return (
                    // eslint-disable-next-line @next/next/no-img-element -- a private, authorised file
                    <img src={fileUrl(item.id, false)} alt={item.fileName} className="mx-auto max-h-[70vh] p-4" />
                  );
                return <p className="p-6 text-center text-[13.5px] text-ink-500">No preview for this file.{!view.viewOnly && ' Download it to open it.'}</p>;
              })()}
            </div>
          )}
        </Card>
      )}
      <p className="text-center text-[12px] text-ink-400">Every time these documents are opened, {view.consultancy} can see when.</p>
    </div>
  );
}
