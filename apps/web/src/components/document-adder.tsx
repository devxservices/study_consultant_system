'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  DOCUMENT_META,
  DOCUMENT_TYPES,
  MAX_DOCUMENTS_PER_CASE,
  DOCUMENT_STATUS_CLIENT_LABEL,
  DOCUMENT_STATUS_TONE,
  type DocumentStatus,
  type DocumentType,
  type DocumentView,
} from '@crm/shared';
import { DocumentUpload } from './document-upload';
import { Pill, cx, type Tone } from './ui';
import { formatBytes } from '@/lib/compress';
import { relativeDays } from '@/lib/format';
import { IconPlus, IconClose, IconFile } from './icons';

const STATUS_TONE: Record<DocumentStatus, Tone> = DOCUMENT_STATUS_TONE;
const STATUS_LABEL: Record<DocumentStatus, string> = DOCUMENT_STATUS_CLIENT_LABEL;

/**
 * Free-form document uploads, beyond the fixed checklist.
 *
 * A case only asks for certain documents, but clients often have more to send -
 * an extra bank statement, a second reference, whatever their consultant asked
 * for in chat. This is the "+ add a document" area: pick a type, upload, repeat,
 * up to the case limit. The count and the cap mirror the server, which is the
 * real boundary.
 */
export function DocumentAdder({
  caseId,
  documents,
  requiredTypes,
  max = MAX_DOCUMENTS_PER_CASE,
}: {
  caseId: string;
  documents: DocumentView[];
  /** Types already handled by the checklist above - not repeated here. */
  requiredTypes: DocumentType[];
  max?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DocumentType>('other');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Live documents = what actually counts against the cap (a superseded copy
  // has been replaced and no longer occupies a slot).
  const live = useMemo(() => documents.filter((d) => !d.supersededById), [documents]);
  const count = live.length;
  const required = new Set(requiredTypes);
  const extras = live.filter((d) => !required.has(d.type as DocumentType));
  const atCap = count >= max;
  const remaining = Math.max(0, max - count);

  async function remove(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-paper p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-950">Add more documents</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-400">
            Anything else your consultant asked for. You can send up to {max} in total.
          </p>
        </div>
        <span
          className={cx(
            'tnum rounded-full px-2.5 py-1 text-[12px] font-medium',
            atCap ? 'bg-warn-50 text-warn-700' : 'bg-ink-50 text-ink-500',
          )}
        >
          {count} of {max} used
        </span>
      </div>

      {/* What the client has added beyond the checklist. */}
      {extras.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {extras.map((d) => {
            const meta = DOCUMENT_META[d.type as DocumentType];
            return (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-400">
                  <IconFile size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink-900">
                    {meta?.label ?? d.type}
                  </p>
                  <p className="truncate text-[12px] text-ink-400">
                    {d.fileName} &middot; {formatBytes(d.fileSize)} &middot; sent{' '}
                    {relativeDays(d.uploadedAt)}
                  </p>
                </div>
                <Pill tone={STATUS_TONE[d.status]} dot>
                  {STATUS_LABEL[d.status]}
                </Pill>
                {d.canDelete && (
                  <button
                    type="button"
                    onClick={() => void remove(d.id)}
                    disabled={deletingId === d.id}
                    className="shrink-0 rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-50 hover:text-bad-700 disabled:opacity-50"
                    title="Remove this document"
                    aria-label={`Remove ${meta?.label ?? d.type}`}
                  >
                    <IconClose size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* The add control. */}
      <div className="mt-4">
        {atCap ? (
          <p className="rounded-lg border border-warn-200 bg-warn-50 px-3 py-2.5 text-[13px] text-warn-700">
            You have reached the limit of {max} documents. Remove one to add another.
          </p>
        ) : !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-[14px] font-medium text-brand-700 transition-colors hover:bg-brand-100"
          >
            <IconPlus size={18} />
            Add a document
          </button>
        ) : (
          <div className="rounded-lg border border-line bg-ink-50/60 p-3">
            <label
              htmlFor={`adder-type-${caseId}`}
              className="mb-1 block text-[12.5px] font-medium text-ink-600"
            >
              What kind of document is this?
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <select
                id={`adder-type-${caseId}`}
                value={type}
                onChange={(e) => setType(e.target.value as DocumentType)}
                className="h-10 flex-1 rounded-md border border-line-strong bg-paper px-3 text-[14px] text-ink-900 focus:border-brand-500"
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_META[t].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 shrink-0 rounded-md border border-line px-3 text-[13px] font-medium text-ink-500 transition-colors hover:bg-ink-100"
              >
                Cancel
              </button>
            </div>

            {/* The hint for the chosen type, then the upload button itself. */}
            <p className="mt-2 text-[12.5px] text-ink-400">{DOCUMENT_META[type].hint}</p>
            <DocumentUpload
              key={type}
              caseId={caseId}
              type={type}
              label={`Upload ${DOCUMENT_META[type].label}`}
            />
            <p className="mt-2 text-[12px] text-ink-400">
              {remaining} more can be added after this one.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
