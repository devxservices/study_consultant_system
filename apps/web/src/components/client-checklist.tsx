'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DOCUMENT_META, type DocumentStatus, type DocumentType, type DocumentView } from '@crm/shared';
import { DocumentUpload } from './document-upload';
import { Pill, cx, type Tone } from './ui';
import { formatBytes } from '@/lib/compress';
import { relativeDays } from '@/lib/format';

type ItemStatus = DocumentStatus | 'missing';

const TONE: Record<ItemStatus, Tone> = {
  verified: 'ok',
  pending: 'warn',
  under_review: 'warn',
  rejected: 'bad',
  reupload_requested: 'bad',
  missing: 'neutral',
};

/** Wording for a nervous applicant, not for a database. */
const LABEL: Record<ItemStatus, string> = {
  verified: 'Approved',
  pending: 'Being checked',
  under_review: 'Being checked',
  rejected: 'Send again',
  reupload_requested: 'Send again',
  missing: 'Not sent yet',
};

export interface ChecklistItem {
  /** A built-in type, or a consultancy's own type key (with its label). */
  type: DocumentType | (string & {});
  status: ItemStatus;
  label?: string;
}

/**
 * The client's checklist, and the only place they need to visit.
 *
 * Each row states what the document is, what state it is in, and - if
 * something is wrong - exactly what to do about it, with the button to do it
 * right there. Nothing here requires messaging anyone to find out what happens
 * next, which is the entire point of the product.
 */
export function ClientChecklist({
  caseId,
  items,
  documents,
  verified,
  required,
  satisfied,
}: {
  caseId: string;
  items: ChecklistItem[];
  documents: DocumentView[];
  verified: number;
  required: number;
  satisfied: boolean;
}) {
  const pct = required === 0 ? 0 : Math.round((verified / required) * 100);
  const rejected = items.filter((i) => i.status === 'rejected');

  // Newest document per type is the one the client is dealing with now.
  const latestByType = new Map<string, DocumentView>();
  for (const d of [...documents].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  )) {
    if (!latestByType.has(d.type)) latestByType.set(d.type, d);
  }

  return (
    <section className="rounded-xl border border-line bg-paper p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink-950">What we need from you</h2>
        <span className="tnum shrink-0 text-[13px] text-ink-500">
          {verified} of {required} done
        </span>
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={cx(
            'h-full rounded-full transition-all',
            satisfied ? 'bg-ok-500' : 'bg-brand-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {rejected.length > 0 && (
        <div className="mb-3 rounded-md border border-bad-200 bg-bad-50 px-3 py-2 text-[13px] text-bad-700">
          {rejected.length === 1
            ? 'One document needs to be sent again.'
            : `${rejected.length} documents need to be sent again.`}{' '}
          The reason is shown below each one.
        </div>
      )}

      {satisfied && (
        <div className="mb-3 rounded-md border border-ok-200 bg-ok-50 px-3 py-2 text-[13px] text-ok-700">
          Everything is approved. Your consultant is moving your application forward.
        </div>
      )}

      <ul className="divide-y divide-line">
        {items.map((item) => (
          <ChecklistRow
            key={item.type}
            caseId={caseId}
            item={item}
            doc={latestByType.get(item.type)}
          />
        ))}
      </ul>
    </section>
  );
}

function ChecklistRow({
  caseId,
  item,
  doc,
}: {
  caseId: string;
  item: ChecklistItem;
  doc: DocumentView | undefined;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = DOCUMENT_META[item.type as DocumentType] as { label: string; hint: string } | undefined;
  const resend = item.status === 'rejected' || item.status === 'reupload_requested';

  async function remove() {
    if (!doc) return;
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(b?.message ?? 'Could not remove that file.');
      setDeleting(false);
      return;
    }
    setDeleting(false);
    router.refresh();
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink-800">{item.label ?? meta?.label ?? item.type}</p>
          {meta?.hint && <p className="text-[12px] leading-snug text-ink-400">{meta.hint}</p>}
        </div>
        <Pill tone={TONE[item.status]} dot={item.status !== 'missing'}>
          {LABEL[item.status]}
        </Pill>
      </div>

      {/* The file they already sent */}
      {doc && item.status !== 'missing' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-400">
          <a
            href={doc.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-700 hover:underline"
          >
            {doc.fileName}
          </a>
          <span>
            {formatBytes(doc.fileSize)} · sent {relativeDays(doc.uploadedAt)}
          </span>
          {doc.canDelete && (
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="text-ink-400 underline underline-offset-2 hover:text-bad-700 disabled:opacity-50"
            >
              {deleting ? 'Removing...' : 'Remove'}
            </button>
          )}
        </div>
      )}

      {/* Why it was rejected, and how to fix it */}
      {resend && doc?.reviewerComment && (
        <p className="mt-2 rounded-md border border-bad-200 bg-bad-50 px-3 py-2 text-[13px] leading-snug text-bad-700">
          {doc.reviewerComment}
        </p>
      )}

      {/* A question your consultant asked about this document */}
      {doc && doc.comments.length > 0 && (
        <ul className="mt-2 space-y-1 border-l-2 border-line pl-2.5">
          {doc.comments.map((c) => (
            <li key={c.id} className="text-[13px] leading-snug text-ink-600">
              <span className="font-medium text-ink-800">
                {c.authorRole === 'client' ? 'You' : c.authorName}:
              </span>{' '}
              {c.body}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-[12px] text-bad-700">
          {error}
        </p>
      )}

      {/* Upload is offered whenever there is something to do */}
      {item.status === 'missing' && <DocumentUpload caseId={caseId} type={item.type} />}
      {resend && doc && (
        <DocumentUpload caseId={caseId} type={item.type} replacesId={doc.id} />
      )}
    </li>
  );
}
