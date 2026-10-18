'use client';

import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { DOCUMENT_META, type DocumentView } from '@crm/shared';
import { Avatar, Button, Pill, cx, type Tone } from './ui';
import { formatBytes } from '@/lib/compress';
import { relativeDays } from '@/lib/format';
import { useCan } from './permissions-context';

const STATUS: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: 'warn', label: 'Awaiting review' },
  verified: { tone: 'ok', label: 'Verified' },
  rejected: { tone: 'bad', label: 'Rejected' },
};

/**
 * One reviewable document.
 *
 * Verify is optimistic: a consultant clearing a queue of 30 documents should
 * never wait on a round trip between clicks. The row flips to Verified
 * immediately and rolls back with an error if the server disagrees.
 *
 * Reject is deliberately NOT optimistic in the same way - it demands a typed
 * reason, so there is already a deliberate pause, and getting it wrong sends a
 * misleading message to the client.
 */
export function DocumentCard({
  doc,
  showClient = false,
}: {
  doc: DocumentView;
  showClient?: boolean;
}) {
  const router = useRouter();
  const can = useCan();
  const may = { verify: can('document.verify'), reject: can('document.reject'), comment: can('document.comment') };
  const [, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(doc.status);
  const [rejecting, setRejecting] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = STATUS[optimisticStatus] ?? STATUS.pending!;
  const meta = DOCUMENT_META[doc.type as keyof typeof DOCUMENT_META];

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${doc.id}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as
        | { message?: string; fieldErrors?: Record<string, string> }
        | null;
      setError(b?.fieldErrors?.comment ?? b?.message ?? 'That did not work. Try again.');
      setBusy(false);
      return false;
    }
    setBusy(false);
    router.refresh();
    return true;
  }

  function verify() {
    // Flip the pill straight away, then confirm with the server.
    startTransition(async () => {
      setOptimisticStatus('verified');
      const ok = await act('/verify');
      if (!ok) router.refresh();
    });
  }

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-medium text-ink-950">{meta?.label ?? doc.type}</p>
            <Pill tone={status.tone} dot>
              {status.label}
            </Pill>
            {doc.supersededById && <Pill tone="neutral">Replaced</Pill>}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-400">
            {showClient && (
              <>
                <span className="text-ink-600">{doc.clientName}</span> ·{' '}
              </>
            )}
            {doc.fileName} · {formatBytes(doc.fileSize)} · uploaded {relativeDays(doc.uploadedAt)} by{' '}
            {doc.uploadedByRole === 'client' ? 'the client' : doc.uploadedByName}
          </p>
        </div>

        <a
          href={doc.downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 shrink-0 items-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink-800 hover:bg-ink-50"
        >
          Open file
        </a>
      </div>

      {doc.reviewerComment && optimisticStatus === 'rejected' && (
        <p className="mt-2.5 rounded-md border border-bad-200 bg-bad-50 px-3 py-2 text-[13px] text-bad-700">
          <span className="font-medium">Rejected:</span> {doc.reviewerComment}
        </p>
      )}

      {doc.comments.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 border-l-2 border-line pl-3">
          {doc.comments.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <Avatar name={c.authorName} size={20} />
              <p className="min-w-0 text-[13px] leading-snug text-ink-600">
                <span className="font-medium text-ink-800">
                  {c.authorRole === 'client' ? c.authorName : c.authorName}
                </span>{' '}
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[13px] text-bad-700">
          {error}
        </p>
      )}

      {/* Actions only make sense while there is a decision left to make. */}
      {optimisticStatus !== 'verified' && (may.verify || may.reject || may.comment) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {may.verify && (
            <Button size="sm" onClick={verify} disabled={busy}>
              Verify
            </Button>
          )}
          {may.reject && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setRejecting((v) => !v);
                setCommenting(false);
              }}
              disabled={busy}
            >
              Reject
            </Button>
          )}
          {may.comment && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCommenting((v) => !v);
                setRejecting(false);
              }}
              disabled={busy}
            >
              Ask a question
            </Button>
          )}
        </div>
      )}

      {rejecting && (
        <div className="mt-3 rounded-md border border-bad-200 bg-bad-50 p-3">
          <label
            htmlFor={`reject-${doc.id}`}
            className="mb-1.5 block text-[13px] font-medium text-bad-700"
          >
            What does the client need to fix?
          </label>
          <textarea
            id={`reject-${doc.id}`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The bottom edge is cut off - please photograph the whole page."
            className="w-full rounded-md border border-bad-200 bg-paper px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-300 focus:border-bad-500"
          />
          <p className="mt-1 text-[12px] text-bad-700/80">
            This is sent to the client word for word, so write it for them.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={busy || reason.trim().length < 10}
              onClick={async () => {
                if (await act('/reject', { comment: reason.trim() })) {
                  setRejecting(false);
                  setReason('');
                }
              }}
            >
              {busy ? 'Sending...' : 'Reject and notify'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {commenting && (
        <div className="mt-3 rounded-md border border-line bg-ink-50 p-3">
          <label
            htmlFor={`comment-${doc.id}`}
            className="mb-1.5 block text-[13px] font-medium text-ink-800"
          >
            Ask the client something
          </label>
          <textarea
            id={`comment-${doc.id}`}
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="e.g. Is this the most recent statement?"
            className="w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-300 focus:border-brand-500"
          />
          <p className="mt-1 text-[12px] text-ink-400">
            The document stays as it is - this does not reject it.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={busy || comment.trim().length < 2}
              onClick={async () => {
                if (await act('/comments', { body: comment.trim() })) {
                  setCommenting(false);
                  setComment('');
                }
              }}
            >
              {busy ? 'Sending...' : 'Send question'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCommenting(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A list of documents with a shared shell, used on the case page and the queue. */
export function DocumentList({
  documents,
  showClient = false,
  className,
}: {
  documents: DocumentView[];
  showClient?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('divide-y divide-line', className)}>
      {documents.map((d) => (
        <DocumentCard key={d.id} doc={d} showClient={showClient} />
      ))}
    </div>
  );
}
