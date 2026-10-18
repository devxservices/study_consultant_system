'use client';

import { useState } from 'react';
import { cx } from '../ui';

export interface HealthSegment {
  key: string;
  label: string;
  count: number;
  tone: 'ok' | 'warn' | 'bad';
}

const TONE_COLOR: Record<HealthSegment['tone'], string> = {
  ok: 'var(--color-ok-500)',
  warn: 'var(--color-warn-500)',
  bad: 'var(--color-bad-500)',
};

const SIZE = 176;
const STROKE = 18;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * The live pipeline split by who is holding each case up.
 *
 * A doughnut, not a pie: the hole carries the total, which is the number a
 * manager reads first, and comparing arc lengths around a common centre is the
 * one thing this shape does honestly. Three parts that sum to the whole is the
 * ceiling for the form - a fourth would go in a bar chart instead.
 *
 * These are status colours, not a series palette, and status colour never
 * carries meaning alone here: every segment is named, counted and given its
 * share in the legend beside it, so the chart reads with no colour vision at
 * all. Segments sweep in once on arrival, separated by a 2px gap of card.
 */
export function CaseHealthDonut({
  segments,
  total,
}: {
  segments: HealthSegment[];
  total: number;
}) {
  const [hover, setHover] = useState<string | null>(null);

  if (total === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-ink-500">
        No active cases to measure yet.
      </p>
    );
  }

  let offset = 0;
  const arcs = segments
    .filter((s) => s.count > 0)
    .map((s) => {
      const fraction = s.count / total;
      const dash = Math.max(0, fraction * C - 2);
      const arc = { ...s, dash, offset, fraction };
      offset += fraction * C;
      return arc;
    });

  const focused = segments.find((s) => s.key === hover) ?? null;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`${total} active cases: ${segments.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ')}.`}
        >
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke="var(--color-ink-100)"
              strokeWidth={STROKE}
            />
            {arcs.map((a, i) => (
              <circle
                key={a.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={TONE_COLOR[a.tone]}
                strokeWidth={hover === a.key ? STROKE + 5 : STROKE}
                strokeDasharray={`${a.dash} ${C - a.dash}`}
                strokeDashoffset={-a.offset}
                className="chart-arc transition-[stroke-width] duration-200"
                style={{ ['--arc-c' as string]: C, animationDelay: `${i * 120}ms` }}
                onPointerEnter={() => setHover(a.key)}
                onPointerLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span key={focused?.key ?? 'total'} className="chart-tip text-[30px] font-medium leading-9 tracking-[-0.02em] text-ink-950">
            {focused ? focused.count : total}
          </span>
          <span className="max-w-[96px] text-[11.5px] leading-4 text-ink-400">
            {focused ? focused.label : 'active cases'}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-1.5">
        {segments.map((s) => {
          const pct = total === 0 ? 0 : Math.round((s.count / total) * 100);
          return (
            <li
              key={s.key}
              tabIndex={0}
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(s.key)}
              onBlur={() => setHover(null)}
              className={cx(
                'flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
                hover === s.key ? 'bg-ink-50' : 'bg-transparent',
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: TONE_COLOR[s.tone] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-700">{s.label}</span>
              <span className="tnum shrink-0 text-[13.5px] font-medium text-ink-950">{s.count}</span>
              <span className="tnum w-10 shrink-0 text-right text-[12.5px] text-ink-400">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
