'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { DOCUMENT_META, DOCUMENT_TYPES, UPLOAD_LIMITS, type DocumentType } from '@crm/shared';
import { compressIfNeeded, formatBytes } from '@/lib/compress';
import { cx } from './ui';

type Phase = 'idle' | 'preparing' | 'uploading' | 'done' | 'error';

/**
 * One upload control per checklist row.
 *
 * Written for someone standing in a queue with a phone: a single big tap
 * target, plain wording, and progress that says what is happening rather than
 * spinning silently. The camera is offered directly because most clients
 * photograph documents rather than scan them.
 */
export function DocumentUpload({
  caseId,
  type,
  replacesId,
  label,
  compact = false,
}: {
  caseId: string;
  /** A built-in type, or a consultancy's own type key. */
  type: DocumentType | (string & {});
  replacesId?: string;
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNote(null);
    setPhase('preparing');
    setProgress(0);

    const original = file.size;
    const prepared = await compressIfNeeded(file);
    if (prepared.size < original) {
      setNote(`Reduced from ${formatBytes(original)} to ${formatBytes(prepared.size)}`);
    }

    if (prepared.size > UPLOAD_LIMITS.maxBytes) {
      setPhase('error');
      setError(
        `This file is ${formatBytes(prepared.size)}. The limit is ${formatBytes(UPLOAD_LIMITS.maxBytes)}.`,
      );
      return;
    }

    const form = new FormData();
    form.set('file', prepared);
    form.set('caseId', caseId);
    // A consultancy's own document types go through the drive, which knows them.
    const builtIn = (DOCUMENT_TYPES as readonly string[]).includes(type);
    form.set(builtIn ? 'type' : 'typeKey', type);
    if (replacesId) form.set('replacesId', replacesId);

    setPhase('uploading');

    // XHR rather than fetch: it reports upload progress, and on a slow phone
    // connection a progress bar is the difference between waiting and retrying.
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', builtIn ? '/api/documents' : '/api/drive/upload');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setPhase('done');
          setProgress(100);
          router.refresh();
        } else {
          let message = 'Upload failed. Please try again.';
          try {
            const body = JSON.parse(xhr.responseText) as {
              message?: string;
              fieldErrors?: Record<string, string>;
            };
            message = body.fieldErrors?.file ?? body.message ?? message;
          } catch {
            /* keep the default */
          }
          setPhase('error');
          setError(message);
        }
        resolve();
      };

      xhr.onerror = () => {
        setPhase('error');
        setError('Could not reach the server. Check your connection and try again.');
        resolve();
      };

      xhr.send(form);
    });

    if (inputRef.current) inputRef.current.value = '';
  }

  const busy = phase === 'preparing' || phase === 'uploading';
  const meta = DOCUMENT_META[type as DocumentType] as (typeof DOCUMENT_META)[DocumentType] | undefined;

  return (
    <div className={compact ? '' : 'mt-2'}>
      <input
        ref={inputRef}
        type="file"
        // capture is a hint, not a lock: the picker still offers Files.
        accept={UPLOAD_LIMITS.acceptedMimeTypes.join(',')}
        className="sr-only"
        id={`upload-${type}-${replacesId ?? 'new'}`}
        onChange={(e) => void onPick(e.target.files?.[0])}
        disabled={busy}
      />

      <label
        htmlFor={`upload-${type}-${replacesId ?? 'new'}`}
        className={cx(
          'inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-[14px] font-medium transition-colors',
          compact ? 'h-8 text-[13px]' : 'h-10',
          busy
            ? 'pointer-events-none border-line bg-ink-50 text-ink-400'
            : replacesId
              ? 'border-bad-200 bg-bad-50 text-bad-700 hover:bg-bad-100'
              : 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100',
        )}
      >
        {phase === 'preparing'
          ? 'Preparing...'
          : phase === 'uploading'
            ? `Uploading ${progress}%`
            : (label ?? (replacesId ? 'Upload a new copy' : `Upload ${meta?.label ?? "the document"}`))}
      </label>

      {phase === 'uploading' && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {note && phase !== 'error' && (
        <p className="mt-1 text-[12px] text-ink-400">{note}</p>
      )}

      {phase === 'error' && error && (
        <p role="alert" className="mt-1.5 text-[12px] text-bad-700">
          {error}
        </p>
      )}
    </div>
  );
}
