import Link from 'next/link';
import { AUDIT_CATEGORIES } from '@crm/shared';
import { cx } from '../ui';

export interface AuditFilterValues {
  category?: string;
  actorId?: string;
  from?: string;
  to?: string;
  q?: string;
}

const CONTROL =
  'h-9 w-full min-w-0 rounded-md border border-line-strong bg-paper px-2.5 text-[13.5px] text-ink-900 placeholder:text-ink-300 focus:border-brand-500';

/**
 * The trail's filters: what kind of event, who, when, and a free-text search
 * over client, person and IP address. A plain GET form, so a filtered view is
 * a URL a manager can bookmark or paste to someone.
 */
export function AuditFilters({
  action,
  values,
  people,
  hidden,
}: {
  /** The page the form submits to. */
  action: string;
  values: AuditFilterValues;
  /** Omitted on one member's own page, where "who" is already decided. */
  people?: { id: string; name: string; active: boolean }[];
  /** Extra fixed params (a member page's tab) carried through each submit. */
  hidden?: Record<string, string>;
}) {
  const withCategory = (key?: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...hidden, ...values, category: key })) {
      if (v && k !== 'page') sp.set(k, v);
    }
    const s = sp.toString();
    return s ? `${action}?${s}` : action;
  };
  const active = values.category ?? '';
  const filtered = Boolean(values.category || values.actorId || values.from || values.to || values.q);

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-1.5" role="list" aria-label="Kind of event">
        {[{ key: '', label: 'Everything' }, ...AUDIT_CATEGORIES].map((c) => (
          <Link
            key={c.key || 'all'}
            role="listitem"
            href={withCategory(c.key || undefined)}
            aria-current={active === c.key ? 'page' : undefined}
            className={cx(
              'rounded-full border px-3 py-1 text-[13px] transition-colors',
              active === c.key
                ? 'border-brand-200 bg-brand-50 font-medium text-brand-700'
                : 'border-line bg-paper text-ink-600 hover:bg-ink-50',
            )}
          >
            {c.label}
          </Link>
        ))}
      </div>

      <form
        method="get"
        action={action}
        className={cx(
          'grid gap-2 rounded-xl bg-paper p-3 shadow-card sm:grid-cols-2',
          people ? 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_150px_150px_auto]' : 'lg:grid-cols-[minmax(0,1.5fr)_150px_150px_auto]',
        )}
      >
        {Object.entries(hidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {values.category && <input type="hidden" name="category" value={values.category} />}

        <label className="block">
          <span className="sr-only">Search</span>
          <input
            name="q"
            defaultValue={values.q ?? ''}
            placeholder="Client, person or IP address"
            className={CONTROL}
          />
        </label>

        {people && (
          <label className="block">
            <span className="sr-only">Who</span>
            <select name="actorId" defaultValue={values.actorId ?? ''} className={CONTROL}>
              <option value="">Everyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.active ? '' : ' (login off)'}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex items-center gap-2">
          <span className="shrink-0 text-[12px] text-ink-400">From</span>
          <input type="date" name="from" defaultValue={values.from ?? ''} className={CONTROL} />
        </label>
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-[12px] text-ink-400">To</span>
          <input type="date" name="to" defaultValue={values.to ?? ''} className={CONTROL} />
        </label>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="press h-9 rounded-lg bg-brand-600 px-4 text-[13.5px] font-medium text-white hover:brightness-[0.93]"
          >
            Apply
          </button>
          {filtered && (
            <Link
              href={withCategory(undefined).split('?')[0] + (hidden && Object.keys(hidden).length ? `?${new URLSearchParams(hidden)}` : '')}
              className="h-9 rounded-md px-3 text-[13px] leading-9 text-ink-500 hover:bg-ink-50 hover:text-ink-800"
            >
              Clear
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
