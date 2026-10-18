'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { DnsRecord, DomainCheckResult, TenantDomainView } from '@crm/shared';
import { relativeDays } from '@/lib/format';
import { siteUrl } from '@/lib/site-url';
import { Button, Card, Pill } from './ui';
import { callApi, Field, FormAlert, TextInput } from './forms';

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* the value is on screen to copy by hand */
        }
      }}
      className="shrink-0 rounded px-1.5 text-[11.5px] font-medium text-brand-700 hover:bg-brand-50"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function Records({ records, audience }: { records: DnsRecord[]; audience: 'admin' | 'owner' }) {
  return (
    <div className="overflow-x-auto rounded-md bg-paper ring-1 ring-line">
      <table className="w-full text-left text-[12.5px]">
        <thead className="text-ink-400">
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Type</th>
            <th className="px-2.5 py-1.5 font-medium">Name / Host</th>
            <th className="px-2.5 py-1.5 font-medium">Value / Points to</th>
          </tr>
        </thead>
        <tbody className="font-mono text-ink-900">
          {records.map((r) => (
            <tr key={`${r.type}-${r.fqdn}-${r.value}`} className="border-t border-line align-top">
              <td className="px-2.5 py-2">{r.type}</td>
              <td className="px-2.5 py-2">
                <span className="inline-flex items-center gap-1 break-all">
                  {r.name}
                  <CopyButton value={r.name} />
                </span>
                {r.name !== r.fqdn && (
                  <span className="block font-sans text-[11.5px] text-ink-400">full name: {r.fqdn}</span>
                )}
              </td>
              <td className="px-2.5 py-2">
                {r.value ? (
                  <span className="inline-flex items-center gap-1 break-all">
                    {r.value}
                    <CopyButton value={r.value} />
                  </span>
                ) : (
                  <span className="font-sans text-warn-700">
                    {audience === 'admin'
                      ? 'Set PUBLIC_IP on the server to show its address here'
                      : 'Ask your platform provider for the server’s IP address'}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A consultancy's web addresses: the platform address it always has, and its
 * own domains with the exact DNS records to add. One component for the
 * platform admin and for the consultancy's own manager - `base` is the API
 * prefix each one uses.
 */
export function DomainsCard({
  base,
  platformHost,
  domains,
  audience,
}: {
  base: string;
  platformHost: string;
  domains: TenantDomainView[];
  audience: 'admin' | 'owner';
}) {
  const router = useRouter();
  const [hostname, setHostname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy('add');
    const res = await callApi(`${base}/domains`, { method: 'POST', json: { hostname: hostname.trim() } });
    setBusy(null);
    if (!res.ok) {
      setError(res.fieldErrors.hostname ?? res.message);
      return;
    }
    setHostname('');
    router.refresh();
  }

  async function check(d: TenantDomainView) {
    setNotice(null);
    setBusy(d.id);
    const res = await callApi<DomainCheckResult>(`${base}/domains/${d.id}/verify`, { method: 'POST' });
    setBusy(null);
    if (!res.ok || !res.data) {
      setNotice({ id: d.id, tone: 'bad', text: res.message ?? 'The check did not run. Please try again.' });
      return;
    }
    setNotice({ id: d.id, tone: res.data.live ? 'ok' : 'warn', text: res.data.message });
    router.refresh();
  }

  async function remove(d: TenantDomainView) {
    if (!confirm(d.live ? `Stop serving the portal at ${d.hostname}? People using that address will lose access.` : `Remove ${d.hostname}?`)) return;
    setNotice(null);
    setBusy(d.id);
    const res = await callApi(`${base}/domains/${d.id}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) setNotice({ id: d.id, tone: 'bad', text: res.message ?? 'That did not work.' });
    router.refresh();
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-ink-950">Web address</h2>
      <p className="mb-4 mt-0.5 text-[12.5px] text-ink-500">
        {audience === 'owner' ? 'Your portal is' : 'Their portal is'} always at{' '}
        <a href={siteUrl(platformHost)} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
          {platformHost}
        </a>
        . {audience === 'owner' ? 'You can also use your own domain' : 'They can also use their own domain'}, like
        portal.example.com - students, staff and partners then sign in there, under {audience === 'owner' ? 'your' : 'their'} name.
      </p>

      {domains.length > 0 && (
        <ul className="mb-5 space-y-3">
          {domains.map((d) => (
            <li key={d.id} className="rounded-lg border border-line p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-all text-[14px] font-medium text-ink-900">{d.hostname}</span>
                {d.live ? (
                  <Pill tone="ok" dot>
                    Live
                  </Pill>
                ) : d.verifiedAt && !d.checkedAt ? (
                  <Pill tone="neutral" dot>
                    Not checked yet
                  </Pill>
                ) : (
                  <Pill tone="warn" dot>
                    Not connected yet
                  </Pill>
                )}
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => check(d)}>
                  {busy === d.id ? 'Checking…' : 'Check now'}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => remove(d)}>
                  Remove
                </Button>
              </div>

              {notice?.id === d.id && (
                <div className="mt-3">
                  <FormAlert tone={notice.tone === 'warn' ? 'bad' : notice.tone}>{notice.text}</FormAlert>
                </div>
              )}

              {d.live ? (
                <p className="mt-2 text-[12.5px] text-ink-500">
                  Open{' '}
                  <a href={`https://${d.hostname}`} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                    https://{d.hostname}
                  </a>
                  . Checked {relativeDays(d.checkedAt)}.
                </p>
              ) : (
                <div className="mt-3 space-y-2.5 rounded-md bg-ink-50 p-3 text-[12.5px] text-ink-600">
                  {audience === 'admin' && <p className="font-medium text-ink-800">Send these steps to the consultancy:</p>}
                  <ol className="list-decimal space-y-2.5 pl-4">
                    <li>
                      Sign in where the domain was bought (GoDaddy, Namecheap, Cloudflare, PKNIC…) and open its DNS settings.
                    </li>
                    <li>
                      Add {d.setup.records.length === 1 ? 'this record' : 'these records'}:
                      <div className="mt-1.5">
                        <Records records={d.setup.records} audience={audience} />
                      </div>
                      {!d.setup.apex && d.setup.alternative.length > 0 && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-ink-500 hover:text-ink-800">
                            Your provider does not allow a CNAME here? Use these instead
                          </summary>
                          <div className="mt-1.5">
                            <Records records={d.setup.alternative} audience={audience} />
                          </div>
                        </details>
                      )}
                    </li>
                    <li>Come back and press “Check now”. It usually works within minutes; it can take up to a day.</li>
                  </ol>
                  <p className="text-ink-400">
                    Using Cloudflare? Set the record to “DNS only” (grey cloud), so the secure certificate can be issued.
                  </p>
                  {d.checkedAt && <p className="text-ink-400">Last checked {relativeDays(d.checkedAt)}.</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} noValidate className="flex flex-wrap items-start gap-2">
        <Field label={domains.length ? 'Add another domain' : 'Connect a domain'} error={error ?? undefined} className="min-w-[220px] flex-1">
          <TextInput value={hostname} onChange={setHostname} placeholder="portal.example.com" invalid={Boolean(error)} />
        </Field>
        <Button type="submit" variant="secondary" disabled={busy !== null || !hostname.trim()} className="mt-6">
          {busy === 'add' ? 'Adding…' : 'Add'}
        </Button>
      </form>
    </Card>
  );
}
