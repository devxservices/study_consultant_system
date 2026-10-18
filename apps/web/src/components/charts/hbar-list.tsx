import Link from 'next/link';

export interface HBarRow {
  key: string;
  label: string;
  value: number;
  /** Secondary fact printed under the bar, e.g. "3 approved". */
  note?: string;
  href?: string;
}

/**
 * Magnitude by category, as labelled progress rows: the value is printed at
 * the end of every row, so nothing depends on reading a bar's length, and one
 * series means one colour - series-1, on a pale track of its own hue. Bars
 * share a start and grow in from it once, in order.
 */
export function HBarList({ rows, max }: { rows: HBarRow[]; max?: number }) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-ink-400">Nothing to show yet.</p>;
  }
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-4">
      {rows.map((r, i) => {
        const pct = Math.max(2, Math.round((r.value / top) * 100));
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13.5px] text-ink-800">{r.label}</span>
              <span className="tnum shrink-0 text-[13.5px] font-medium text-ink-950">{r.value}</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full"
              style={{ background: 'color-mix(in oklab, var(--color-series-1) 13%, var(--color-paper))' }}
            >
              <div
                className="chart-grow-x h-full rounded-full"
                style={{ width: `${pct}%`, background: 'var(--color-series-1)', animationDelay: `${i * 60}ms` }}
              />
            </div>
            {r.note && <p className="mt-1.5 text-[12px] text-ink-400">{r.note}</p>}
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="block rounded-md transition-opacity hover:opacity-80">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
