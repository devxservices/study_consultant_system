'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Stage } from '@crm/shared';
import { cx } from './ui';

export interface FunnelStage {
  stage: Stage;
  label: string;
  total: number;
  stuck: number;
}

/**
 * Where every live case sits in the pipeline, and how much of each stage has
 * stalled.
 *
 * Horizontal bars rather than a tapering "funnel" shape: a funnel's width is
 * read as area, which misrepresents the numbers, and these stages are not a
 * strict drop-off sequence anyway - cases enter partway through and move back.
 * Ordered categories with long names read better horizontally.
 *
 * Two series only, and the second one is a status: series blue for moving,
 * red for stalled. Fixed colours rather than the brand, so a consultancy's own
 * colour can never be mistaken for either. Every bar carries its number
 * directly, so colour is never the only channel; bars grow in from the shared
 * start, in stage order, on arrival.
 */
export function Funnel({
  stages,
  hrefBase,
}: {
  stages: FunnelStage[];
  /** A path; the stage is appended as a query filter. Server components
      cannot hand a function across to a client component. */
  hrefBase: string;
}) {
  const [hovered, setHovered] = useState<Stage | null>(null);
  const max = Math.max(1, ...stages.map((s) => s.total));
  const anyStuck = stages.some((s) => s.stuck > 0);

  return (
    <div>
      {/* Legend: always present with two series, never colour alone. */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-[var(--color-series-1)]" aria-hidden />
          Moving normally
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-bad-500" aria-hidden />
          Stalled past this stage&rsquo;s limit
        </span>
      </div>

      <ul className="space-y-px">
        {stages.map((s, i) => {
          const moving = s.total - s.stuck;
          const pct = (n: number) => (n / max) * 100;
          const active = hovered === s.stage;

          return (
            <li key={s.stage}>
              <Link
                href={`${hrefBase}?stage=${s.stage}`}
                onMouseEnter={() => setHovered(s.stage)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(s.stage)}
                onBlur={() => setHovered(null)}
                className={cx(
                  'group grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 transition-colors sm:grid-cols-[215px_1fr_auto]',
                  active ? 'bg-ink-50' : 'hover:bg-ink-50',
                )}
                title={
                  s.total === 0
                    ? `${s.label}: no cases`
                    : `${s.label}: ${s.total} case${s.total === 1 ? '' : 's'}` +
                      (s.stuck ? `, ${s.stuck} stalled` : '')
                }
              >
                <span className="min-w-0 truncate text-[13px] text-ink-700 group-hover:text-ink-950">
                  {s.label}
                </span>

                {/* Bar track spans the full row on mobile, its own column above sm. */}
                <span
                  className="col-span-2 flex h-4 items-center gap-[2px] sm:col-span-1"
                  aria-hidden
                >
                  {s.total === 0 ? (
                    <span className="h-[3px] w-2 rounded-full bg-ink-200" />
                  ) : (
                    <>
                      {moving > 0 && (
                        <span
                          className="chart-grow-x h-2.5 rounded-[3px] bg-[var(--color-series-1)]"
                          style={{ width: `max(4px, ${pct(moving)}%)`, animationDelay: `${i * 50}ms` }}
                        />
                      )}
                      {s.stuck > 0 && (
                        <span
                          className="chart-grow-x h-2.5 rounded-[3px] bg-bad-500"
                          style={{ width: `max(4px, ${pct(s.stuck)}%)`, animationDelay: `${i * 50 + 120}ms` }}
                        />
                      )}
                    </>
                  )}
                </span>

                <span className="flex items-baseline gap-2 justify-self-end">
                  {s.stuck > 0 && (
                    <span className="tnum text-[12px] font-medium text-bad-700">
                      {s.stuck} stalled
                    </span>
                  )}
                  <span
                    className={cx(
                      'tnum w-6 text-right text-[14px] font-semibold',
                      s.total === 0 ? 'text-ink-300' : 'text-ink-950',
                    )}
                  >
                    {s.total}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {!anyStuck && (
        <p className="mt-3 border-t border-line pt-3 text-[13px] text-ok-700">
          Nothing has stalled. Every case is inside the expected time for its stage.
        </p>
      )}
    </div>
  );
}

/**
 * The same numbers as a table, for screen readers, printing, and anyone who
 * would rather read the figures than the bars.
 */
export function FunnelTable({ stages }: { stages: FunnelStage[] }) {
  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-[13px] text-ink-500 hover:text-ink-800">
        View as a table
      </summary>
      <table className="mt-2 w-full border-collapse text-[13px]">
        <caption className="sr-only">Active cases at each pipeline stage</caption>
        <thead>
          <tr className="border-b border-line text-left text-[12.5px] text-ink-500">
            <th scope="col" className="py-1.5 font-medium">
              Stage
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Cases
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Stalled
            </th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.stage} className="border-b border-line last:border-0">
              <td className="py-1.5 text-ink-700">{s.label}</td>
              <td className="tnum py-1.5 text-right text-ink-900">{s.total}</td>
              <td
                className={cx(
                  'tnum py-1.5 text-right',
                  s.stuck > 0 ? 'text-bad-700' : 'text-ink-300',
                )}
              >
                {s.stuck || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
