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
 * The reference's fixed category order: orange, purple, cyan, indigo, grey.
 * These are categories, not series of one measure - each row is its own
 * thing - so each takes the next colour, and its label wears it too.
 */
const ROW_COLOR = [
  'var(--color-series-1)',
  'var(--color-series-3)',
  'var(--color-series-2)',
  'var(--color-series-4)',
  'var(--color-series-5)',
];

/** A label in its bar's colour, pulled towards the ink so it stays readable. */
const labelColor = (i: number) =>
  i % ROW_COLOR.length === 4
    ? 'var(--color-ink-600)'
    : `color-mix(in oklab, ${ROW_COLOR[i % ROW_COLOR.length]} 72%, var(--color-ink-950))`;

/** Below this share of the track a figure no longer fits inside its bar. */
const INSIDE_MIN_PCT = 16;

/**
 * Magnitude by category, drawn as the reference's bar list: the label in a
 * column of its own, then a bar in the row's colour over a faint vertical
 * grid, with the value printed inside it - or just past its end when the bar
 * is too short to hold it - so nothing depends on reading a bar's length.
 * Bars share a start and grow in from it once, in order.
 */
export function HBarList({ rows, max }: { rows: HBarRow[]; max?: number }) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-ink-400">Nothing to show yet.</p>;
  }
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="relative">
      {/* The vertical grid, behind the bar column only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-[calc(6.5rem+12px)] right-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, var(--color-line-strong) 0 1px, transparent 1px calc(100% / 8))',
          backgroundSize: '100% 100%',
          opacity: 0.7,
        }}
      />
      <ul className="relative space-y-3">
        {rows.map((r, i) => {
          const pct = Math.max(2, Math.round((r.value / top) * 100));
          const color = ROW_COLOR[i % ROW_COLOR.length];
          const grey = i % ROW_COLOR.length === 4;
          const inside = pct >= INSIDE_MIN_PCT;
          const body = (
            <>
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
                <span className="truncate text-right text-[13px] font-medium" style={{ color: labelColor(i) }} title={r.label}>
                  {r.label}
                </span>
                <div className="relative flex h-7 items-center">
                  <div
                    className="chart-grow-x flex h-full items-center rounded-[4px] px-2.5"
                    style={{ width: `${pct}%`, background: color, animationDelay: `${i * 60}ms` }}
                  >
                    {inside && (
                      <span className={grey ? 'tnum text-[12px] font-semibold text-ink-800' : 'tnum text-[12px] font-semibold text-white'}>
                        {r.value}
                      </span>
                    )}
                  </div>
                  {!inside && <span className="tnum ml-2 text-[12px] font-semibold text-ink-800">{r.value}</span>}
                </div>
              </div>
              {r.note && <p className="mt-1 pl-[calc(6.5rem+12px)] text-[12px] text-ink-500">{r.note}</p>}
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
    </div>
  );
}
