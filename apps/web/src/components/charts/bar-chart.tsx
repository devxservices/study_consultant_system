'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney } from '@crm/shared';
import { ChartTooltip } from './genius-line-chart';

export interface BarPoint {
  key: string;
  label: string;
  value: number;
}

const PAD = { top: 18, right: 8, bottom: 28, left: 52 };
const HEIGHT = 240;

/**
 * One series of columns - money collected per month.
 *
 * Single series, so no legend box: the panel title names it. Columns are at
 * most 24px wide with the surface showing between them, rounded 4px at the
 * data end and square on the baseline they grow up from, once, on arrival.
 * The grid is a set of faint solid hairlines; the exact value lives in the
 * hover tooltip and in the table screen readers get.
 */
export function BarChart({
  points,
  currency,
  ariaLabel,
  valueLabel = '',
}: {
  /** Values in minor units when `currency` is given, plain counts otherwise. */
  points: BarPoint[];
  currency?: string;
  ariaLabel: string;
  /** What a value is, for the tooltip - "collected". */
  valueLabel?: string;
}) {
  // Formatting lives here, not in a prop: a function cannot cross from a
  // server component into this client one.
  const format = (n: number) => (currency ? formatMoney(n, currency) : n.toLocaleString());
  const scale = currency ? 100 : 1;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(260, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    const innerW = width - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const max = Math.max(1, ...points.map((p) => p.value));
    const niceMax = niceCeil(max);
    const slot = innerW / Math.max(1, points.length);
    const barW = Math.max(6, Math.min(24, slot * 0.42));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => niceMax * f);
    return {
      innerH,
      slot,
      barW,
      ticks,
      y: (v: number) => PAD.top + innerH - (v / niceMax) * innerH,
    };
  }, [points, width]);

  const active = hover !== null ? points[hover] : null;

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={ariaLabel}
        className="block overflow-visible"
        onPointerLeave={() => setHover(null)}
      >
        {geom.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={geom.y(t)}
              y2={geom.y(t)}
              stroke={t === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'}
            />
            <text
              x={PAD.left - 8}
              y={geom.y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="tnum fill-ink-400 text-[10.5px]"
            >
              {compact(t / scale)}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          const cx = PAD.left + geom.slot * i + geom.slot / 2;
          const top = geom.y(p.value);
          const h = Math.max(0, PAD.top + geom.innerH - top);
          const r = Math.min(4, h / 2, geom.barW / 2);
          const x = cx - geom.barW / 2;
          const base = PAD.top + geom.innerH;
          return (
            <g key={p.key}>
              {h > 0 && (
                <path
                  d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + geom.barW - r} Q${x + geom.barW},${top} ${x + geom.barW},${top + r} V${base} Z`}
                  fill="var(--color-series-1)"
                  opacity={hover === null || hover === i ? 1 : 0.4}
                  className="chart-grow-y transition-opacity duration-150"
                  style={{ animationDelay: `${i * 45}ms` }}
                />
              )}
              <text
                x={cx}
                y={HEIGHT - 8}
                textAnchor="middle"
                className={hover === i ? 'fill-ink-800 text-[11px] font-medium' : 'fill-ink-400 text-[11px]'}
              >
                {p.label}
              </text>
              {/* Hit target: the whole slot, far larger than the bar. */}
              <rect
                x={PAD.left + geom.slot * i}
                y={PAD.top}
                width={geom.slot}
                height={geom.innerH}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${p.label}: ${format(p.value)}`}
                className="outline-none"
              />
            </g>
          );
        })}
      </svg>

      {active && hover !== null && (
        <ChartTooltip
          left={PAD.left + geom.slot * hover + geom.slot / 2}
          width={width}
          top={Math.max(0, geom.y(active.value) - 64)}
          title={active.label}
          rows={[{ key: active.key, color: 'var(--color-series-1)', label: valueLabel, value: format(active.value) }]}
        />
      )}

      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A round ceiling for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceCeil(n: number): number {
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= n) return m * pow;
  return 10 * pow;
}

/** Axis ticks in thousands/millions - the tooltip has the exact figure. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}
