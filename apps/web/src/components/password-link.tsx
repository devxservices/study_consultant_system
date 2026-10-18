'use client';

import { useState } from 'react';
import type { PasswordLinkResult } from '@crm/shared';
import { formatDate } from '@/lib/format';
import { Button } from './ui';

/**
 * What staff see after sending someone a set-password link: whether the
 * email went, and the same link to send by WhatsApp or copy into any chat -
 * many students answer WhatsApp long before they open email.
 */
export function SentLink({ result, email, name }: { result: PasswordLinkResult; email: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const message = `Hello ${name.split(/\s+/)[0]}, here is the link to set your password: ${result.link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-ok-200 bg-ok-50 p-3 text-[13px] text-ok-700">
      <p>
        {result.emailed ? (
          <>
            Link emailed to <span className="font-medium">{email}</span>.
          </>
        ) : (
          <>The email could not be sent. Send them this link instead.</>
        )}{' '}
        It works once, until {formatDate(result.expiresAt)}.
      </p>
      <p className="mt-2 break-all rounded-md bg-paper px-2 py-1.5 font-mono text-[12px] text-ink-800 ring-1 ring-line">
        {result.link}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink-800 hover:bg-ink-50"
        >
          Send by WhatsApp
        </a>
      </div>
    </div>
  );
}
