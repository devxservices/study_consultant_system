'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Avatar, cx } from './ui';
import { IconSearch } from './icons';

interface Hit {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  primaryCase: { currentStage: string; targetCountry: string } | null;
}

/**
 * Search across the clients the signed-in user is allowed to see.
 *
 * The typeahead is a shortcut, not a separate index: it calls the same
 * `/clients?q=` endpoint the list page uses, so it is scoped by the same SQL
 * and a consultant can never surface a colleague's client here. Enter with no
 * row selected falls through to the full list page, which is the honest
 * behaviour when a query has more matches than a dropdown can hold.
 */
export function GlobalSearch({ action }: { action: string }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere, the way every tool this audience already
  // uses does - but never while they are typing into something else.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Debounced, and every in-flight request is abortable, so a fast typist never
  // sees an older response overwrite a newer one.
  // Partners search their own students on their list page; the live client
  // lookup is staff-only and would wrongly show them nothing.
  const live = !action.startsWith('/partner');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || !live) {
      setHits(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/clients?pageSize=6&q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { items: Hit[] };
        setHits(data.items);
        setActive(-1);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q, live]);

  const base = action.replace(/\/$/, '');
  const detailBase = base === '/overview/clients' ? '/overview/clients' : '/desk/clients';

  function go(hit: Hit) {
    setOpen(false);
    setQ('');
    router.push(`${detailBase}/${hit.id}`);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (active >= 0 && hits?.[active]) return go(hits[active]);
    if (!q.trim()) return;
    setOpen(false);
    router.push(`${base}?q=${encodeURIComponent(q.trim())}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!hits?.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  const showPanel = live && open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 sm:max-w-sm lg:max-w-[340px]">
      <form onSubmit={submit} role="search">
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search clients
        </label>
        <div className="group/search relative">
          <IconSearch
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 transition-colors group-focus-within/search:text-brand-600"
          />
          <input
            ref={inputRef}
            id={`${listId}-input`}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={live ? 'Search clients by name, email or phone' : 'Search your students, then press Enter'}
            autoComplete="off"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-autocomplete="list"
            className="h-10 w-full rounded-lg border border-transparent bg-paper pl-10 pr-10 text-[13.5px] text-ink-900 shadow-tile transition-[border-color,box-shadow] duration-150 placeholder:text-ink-400 focus:border-brand-400 focus:shadow-[0_0_0_4px_var(--color-brand-100)] focus:outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {loading ? (
            <span
              aria-hidden
              className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-brand-500 border-r-transparent"
            />
          ) : (
            <kbd
              className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line-strong bg-ink-50 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-400 sm:block"
              aria-hidden
            >
              /
            </kbd>
          )}
        </div>
      </form>

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          aria-label="Client results"
          className="popover absolute inset-x-0 top-[calc(100%+10px)] z-40 overflow-hidden rounded-xl border border-line bg-paper shadow-pop [--origin:top_center]"
        >
          {loading && hits === null ? (
            <p className="px-3.5 py-3 text-[13px] text-ink-400">Searching...</p>
          ) : hits && hits.length > 0 ? (
            <ul className="max-h-[320px] overflow-y-auto py-1">
              {hits.map((hit, i) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(hit)}
                    className={cx(
                      'flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors',
                      i === active ? 'bg-brand-50' : 'bg-transparent',
                    )}
                  >
                    <Avatar name={hit.fullName} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink-900">
                        {hit.fullName}
                      </span>
                      <span className="block truncate text-[12px] text-ink-400">
                        {hit.email ?? hit.phone ?? 'No contact details'}
                      </span>
                    </span>
                    {hit.primaryCase && (
                      <span className="shrink-0 text-[12px] text-ink-400">
                        {hit.primaryCase.targetCountry}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              <li className="border-t border-line">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(`${base}?q=${encodeURIComponent(q.trim())}`);
                  }}
                  className="w-full px-3.5 py-2.5 text-left text-[12.5px] font-medium text-brand-700 transition-colors hover:bg-brand-50"
                >
                  See all results for &ldquo;{q.trim()}&rdquo;
                </button>
              </li>
            </ul>
          ) : (
            <p className="px-3.5 py-3 text-[13px] text-ink-500">
              No client matches &ldquo;{q.trim()}&rdquo;.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
