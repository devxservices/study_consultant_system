'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type DragEvent } from 'react';
import { UPLOAD_TYPES, type DocumentTypeView } from '@crm/shared';
import { formatBytes } from '@/lib/compress';
import { uploadToDrive, type UploadTarget } from '@/lib/upload';
import { Button, cx } from '../ui';
import { IconCamera, IconCheck, IconUpload } from '../icons';

interface Item {
  key: string;
  name: string;
  size: number;
  percent: number;
  state: 'waiting' | 'sending' | 'done' | 'error';
  message?: string;
}

/**
 * Drag files in, or pick them, or take a photo - several at once, each with
 * its own progress. Large files go up in resumable chunks, photos are made
 * smaller first, and the type is worked out from the file name unless one is
 * chosen. Built for a phone on a slow connection as much as for a desk.
 */
export function DropZone({
  target,
  types,
  acceptedTypes,
  maxFileMb,
  compact = false,
  title = 'Drop files here',
  onUploaded,
}: {
  target: UploadTarget;
  /** Offer a type to file them as; empty means "work it out". */
  types?: DocumentTypeView[];
  acceptedTypes: string[];
  maxFileMb: number;
  compact?: boolean;
  title?: string;
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [typeKey, setTypeKey] = useState(target.typeKey ?? '');
  const [expiresOn, setExpiresOn] = useState('');
  const accept = UPLOAD_TYPES.filter((t) => acceptedTypes.includes(t.key))
    .flatMap((t) => [t.mime, ...t.extensions])
    .join(',');
  const chosenType = types?.find((t) => t.key === typeKey);

  async function send(files: File[]) {
    if (!files.length) return;
    const batch = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, percent: 0, state: 'waiting' as const }));
    setItems((prev) => [...batch, ...prev].slice(0, 30));
    const update = (key: string, patch: Partial<Item>) =>
      setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

    let anyDone = false;
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const key = batch[i]!.key;
      if (file.size > maxFileMb * 1024 * 1024 * 3) {
        // Photos shrink before sending; anything far beyond the limit will not.
        update(key, { state: 'error', message: `Larger than the ${maxFileMb} MB limit.` });
        continue;
      }
      update(key, { state: 'sending' });
      try {
        await uploadToDrive(
          file,
          { ...target, ...(typeKey ? { typeKey } : {}), ...(expiresOn ? { expiresOn } : {}) },
          (p) => update(key, { percent: p.percent, message: p.reducedFrom ? `Made smaller from ${formatBytes(p.reducedFrom)}` : undefined }),
        );
        update(key, { state: 'done', percent: 100 });
        anyDone = true;
      } catch (err) {
        update(key, { state: 'error', message: (err as Error).message });
      }
    }
    if (anyDone) {
      onUploaded?.();
      router.refresh();
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void send([...e.dataTransfer.files]);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cx(
          'rounded-xl border-2 border-dashed transition-colors',
          over ? 'border-brand-400 bg-brand-50/60' : 'border-line-strong bg-paper',
          compact ? 'px-4 py-4' : 'px-5 py-7',
        )}
      >
        <div className={cx('flex flex-col items-center text-center', compact && 'sm:flex-row sm:text-left sm:gap-4')}>
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-info-50 text-info-600">
            <IconUpload size={20} />
          </span>
          <div className={cx('mt-2 min-w-0 flex-1', compact && 'sm:mt-0')}>
            <p className="text-[14.5px] font-medium text-ink-900">{title}</p>
            <p className="text-[12.5px] text-ink-500">
              {UPLOAD_TYPES.filter((t) => acceptedTypes.includes(t.key)).map((t) => t.label).join(', ')} · up to {maxFileMb} MB each ·
              several at once
            </p>
          </div>
          <div className={cx('mt-3 flex flex-wrap justify-center gap-2', compact && 'sm:mt-0')}>
            <Button size="sm" onClick={() => pick.current?.click()}>
              <IconUpload size={15} />
              Choose files
            </Button>
            <Button size="sm" variant="secondary" onClick={() => camera.current?.click()} className="sm:hidden">
              <IconCamera size={15} />
              Take a photo
            </Button>
          </div>
        </div>

        {(types?.length || !compact) && (
          <div className="mt-4 flex flex-wrap items-end justify-center gap-3 border-t border-line pt-3">
            {types && types.length > 0 && (
              <label className="text-[12.5px] text-ink-600">
                File them as
                <select
                  value={typeKey}
                  onChange={(e) => setTypeKey(e.target.value)}
                  className="ml-2 h-8 rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink-800"
                >
                  <option value="">Work it out from the name</option>
                  {types
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {(!types || chosenType?.hasExpiry) && (
              <label className="text-[12.5px] text-ink-600">
                Expires on
                <input
                  type="date"
                  value={expiresOn}
                  onChange={(e) => setExpiresOn(e.target.value)}
                  className="ml-2 h-8 rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink-800"
                />
              </label>
            )}
          </div>
        )}

        <input ref={pick} type="file" multiple accept={accept} className="hidden" onChange={(e) => { void send([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void send([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-live="polite">
          {items.map((it) => (
            <li key={it.key} className="rounded-lg bg-paper px-3 py-2 shadow-tile">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] text-ink-800">{it.name}</span>
                <span
                  className={cx(
                    'flex shrink-0 items-center gap-1 text-[12px] font-medium',
                    it.state === 'done' ? 'text-ok-700' : it.state === 'error' ? 'text-bad-700' : 'text-ink-500',
                  )}
                >
                  {it.state === 'done' && <IconCheck size={13} />}
                  {it.state === 'done' ? 'Uploaded' : it.state === 'error' ? 'Not uploaded' : it.state === 'waiting' ? 'Waiting' : `${it.percent}%`}
                </span>
              </div>
              {it.state === 'sending' && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full origin-left rounded-full bg-brand-500 transition-transform" style={{ transform: `scaleX(${it.percent / 100})` }} />
                </div>
              )}
              {it.message && <p className={cx('mt-1 text-[12px]', it.state === 'error' ? 'text-bad-700' : 'text-ink-400')}>{it.message}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
