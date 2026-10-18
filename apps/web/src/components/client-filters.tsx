'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { localIsoDate, STAGE_DEFINITIONS, STAGE_ORDER } from '@crm/shared';
import { cx } from './ui';

const FOCUS =
  'transition-[border-color,box-shadow] duration-150 focus:border-brand-500 focus:shadow-[0_0_0_4px_var(--color-brand-100)] focus:outline-none';

const SORTS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'stalest', label: 'Least recently touched' },
  { value: 'stage', label: 'Furthest along' },
  { value: 'name', label: 'Name A-Z' },
] as const;

/**
 * Filters live in the URL, so a consultant can bookmark "my UK clients stuck in
 * documents" and share it with their manager.
 */
const iso = (d: Date) => localIsoDate(d);

/** Preset ranges over "when the client was added". Values map to createdFrom/To. */
function presetRange(v: string): { from?: string; to?: string } {
  const now = new Date();
  switch (v) {
    case '7':
      return { from: iso(new Date(Date.now() - 7 * 86_400_000)) };
    case '30':
      return { from: iso(new Date(Date.now() - 30 * 86_400_000)) };
    case 'month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
    case 'lastmonth':
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    default:
      return {};
  }
}

function matchPreset(from: string, to: string): string {
  if (!from && !to) return '';
  for (const p of ['7', '30', 'month', 'lastmonth']) {
    const r = presetRange(p);
    if ((r.from ?? '') === from && (r.to ?? '') === to) return p;
  }
  return 'custom';
}

export function ClientFilters({
  consultants,
  showConsultantFilter = false,
  showDateFilter = false,
}: {
  consultants?: { id: string; name: string }[];
  showConsultantFilter?: boolean;
  showDateFilter?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(params.get('q') ?? '');
  const firstRender = useRef(true);

  function apply(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    }
    // Any filter change invalidates the current page number.
    sp.delete('page');
    startTransition(() => router.replace(`?${sp.toString()}`, { scroll: false }));
  }

  // Debounce typing so every keystroke is not a round trip.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => apply({ q: q.trim() || undefined }), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const stage = params.get('stage') ?? '';
  const sort = params.get('sort') ?? 'recent';
  const programme = params.get('programme') ?? '';
  const consultantId = params.get('consultantId') ?? '';
  const createdFrom = params.get('createdFrom') ?? '';
  const createdTo = params.get('createdTo') ?? '';
  const datePreset = matchPreset(createdFrom, createdTo);
  const hasFilters = Boolean(
    q || stage || consultantId || createdFrom || createdTo || programme || sort !== 'recent',
  );

  return (
    <div className="flex flex-wrap items-center gap-2 pb-4">
      {/* A basis, so a full row wraps rather than squeezing the search box to its icon. */}
      <div className="relative min-w-0 flex-1 basis-[240px] sm:max-w-xs">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400"
          aria-hidden
        >
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or phone"
          aria-label="Search clients"
          className={`h-9.5 w-full rounded-lg border border-line-strong bg-paper pl-8 pr-3 text-[14px] text-ink-900 placeholder:text-ink-300 ${FOCUS}`}
        />
      </div>

      <Select
        value={stage}
        onChange={(v) => apply({ stage: v })}
        aria-label="Filter by stage"
        placeholder="All stages"
      >
        <option value="">All stages</option>
        {STAGE_ORDER.map((s) => (
          <option key={s} value={s}>
            {STAGE_DEFINITIONS[s].label}
          </option>
        ))}
      </Select>

      {showConsultantFilter && consultants && (
        <Select
          value={consultantId}
          onChange={(v) => apply({ consultantId: v })}
          aria-label="Filter by consultant"
        >
          <option value="">All consultants</option>
          {consultants.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}

      {showDateFilter && (
        <>
          <Select
            value={datePreset}
            onChange={(v) => {
              const r = presetRange(v ?? '');
              apply({ createdFrom: r.from, createdTo: r.to });
            }}
            aria-label="Filter by date added"
          >
            <option value="">Any time added</option>
            <option value="7">Added in last 7 days</option>
            <option value="30">Added in last 30 days</option>
            <option value="month">Added this month</option>
            <option value="lastmonth">Added last month</option>
            {datePreset === 'custom' && <option value="custom">Custom range</option>}
          </Select>

          {/* Exact from/to, for a specific date the presets do not cover. */}
          <input
            type="date"
            value={createdFrom}
            max={createdTo || undefined}
            onChange={(e) => apply({ createdFrom: e.target.value || undefined })}
            aria-label="Added from date"
            className={`h-9.5 rounded-lg border border-line-strong bg-paper px-2 text-[13px] text-ink-800 ${FOCUS}`}
          />
          <span className="text-[12px] text-ink-400">to</span>
          <input
            type="date"
            value={createdTo}
            min={createdFrom || undefined}
            onChange={(e) => apply({ createdTo: e.target.value || undefined })}
            aria-label="Added to date"
            className={`h-9.5 rounded-lg border border-line-strong bg-paper px-2 text-[13px] text-ink-800 ${FOCUS}`}
          />
        </>
      )}

      <Select value={programme} onChange={(v) => apply({ programme: v })} aria-label="Filter by programme">
        <option value="">Study abroad and courses</option>
        <option value="study_abroad">Study abroad</option>
        <option value="course_only">Course only</option>
      </Select>

      <Select value={sort} onChange={(v) => apply({ sort: v })} aria-label="Sort clients">
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setQ('');
            startTransition(() => router.replace('?', { scroll: false }));
          }}
          className="press h-9.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-900"
        >
          Clear
        </button>
      )}

      <span
        aria-live="polite"
        className={cx(
          'text-[12px] text-ink-400 transition-opacity',
          pending ? 'opacity-100' : 'opacity-0',
        )}
      >
        Updating...
      </span>
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  placeholder?: string;
  'aria-label': string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value || undefined!)}
      aria-label={rest['aria-label']}
      className={`h-9.5 rounded-lg border border-line-strong bg-paper px-2.5 text-[13px] text-ink-800 ${FOCUS}`}
    >
      {children}
    </select>
  );
}
