'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { DOCUMENT_STATUSES, DOCUMENT_STATUS_LABEL, type DocumentTypeView } from '@crm/shared';
import { cx } from '../ui';
import { IconGrid, IconList, IconSearch } from '../icons';

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name' },
  { value: 'expiry', label: 'Expiring soonest' },
  { value: 'status', label: 'Status' },
  { value: 'size', label: 'Largest' },
];

/**
 * Search and filters for the drive. Everything lives in the address, so a
 * filtered view can be bookmarked or sent to a colleague, and Back works.
 */
export function DriveToolbar({ types, staff }: { types: DocumentTypeView[]; staff: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const defaultSort = params.get('view') === 'expiring' ? 'expiry' : 'newest';
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [more, setMore] = useState(Boolean(params.get('country') || params.get('tag') || params.get('from') || params.get('uploaderRole')));
  const first = useRef(true);

  function apply(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    }
    sp.delete('page');
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => apply({ q: q.trim() || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const layout = params.get('layout') === 'grid' ? 'grid' : 'list';
  const select = 'h-9 rounded-lg border border-line-strong bg-paper px-2.5 text-[13px] text-ink-800';

  return (
    <div className={cx('mb-4 space-y-2 transition-opacity', pending && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-[220px]">
          <IconSearch size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={staff ? 'Search file, student, type or tag' : 'Search your documents'}
            aria-label="Search documents"
            className="h-9 w-full rounded-lg border border-line-strong bg-paper pl-8 pr-3 text-[13.5px] text-ink-900 placeholder:text-ink-300"
          />
        </div>
        <select aria-label="Type" value={params.get('type') ?? ''} onChange={(e) => apply({ type: e.target.value })} className={select}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={params.get('status') ?? ''} onChange={(e) => apply({ status: e.target.value })} className={select}>
          <option value="">Any status</option>
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DOCUMENT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="Sort" value={params.get('sort') ?? defaultSort} onChange={(e) => apply({ sort: e.target.value === defaultSort ? undefined : e.target.value })} className={select}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {staff && (
          <button type="button" onClick={() => setMore((v) => !v)} className="h-9 rounded-lg px-2.5 text-[13px] font-medium text-brand-700 hover:bg-brand-50" aria-expanded={more}>
            {more ? 'Fewer filters' : 'More filters'}
          </button>
        )}
        <div className="ml-auto flex rounded-lg bg-ink-100 p-0.5" role="radiogroup" aria-label="Layout">
          {(['list', 'grid'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={layout === l}
              onClick={() => apply({ layout: l === 'list' ? undefined : l })}
              className={cx('flex h-8 w-8 items-center justify-center rounded-md', layout === l ? 'bg-paper text-ink-900 shadow-card' : 'text-ink-500')}
            >
              {l === 'list' ? <IconList size={16} /> : <IconGrid size={16} />}
              <span className="sr-only">{l}</span>
            </button>
          ))}
        </div>
      </div>
      {more && staff && (
        <div className="flex flex-wrap items-center gap-2">
          <input defaultValue={params.get('country') ?? ''} onBlur={(e) => apply({ country: e.target.value.trim() })} placeholder="Country, e.g. Canada" aria-label="Country" className={cx(select, 'w-44')} />
          <select aria-label="Uploaded by" value={params.get('uploaderRole') ?? ''} onChange={(e) => apply({ uploaderRole: e.target.value })} className={select}>
            <option value="">Uploaded by anyone</option>
            <option value="client">Students</option>
            <option value="staff">Staff</option>
            <option value="partner">Partners</option>
          </select>
          <input defaultValue={params.get('tag') ?? ''} onBlur={(e) => apply({ tag: e.target.value.trim() })} placeholder="Tag" aria-label="Tag" className={cx(select, 'w-32')} />
          <label className="flex items-center gap-1 text-[12.5px] text-ink-500">
            From
            <input type="date" defaultValue={params.get('from') ?? ''} onChange={(e) => apply({ from: e.target.value })} className={select} />
          </label>
          <label className="flex items-center gap-1 text-[12.5px] text-ink-500">
            to
            <input type="date" defaultValue={params.get('to') ?? ''} onChange={(e) => apply({ to: e.target.value })} className={select} />
          </label>
        </div>
      )}
    </div>
  );
}
