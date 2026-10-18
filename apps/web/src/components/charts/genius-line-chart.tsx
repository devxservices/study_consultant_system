'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '../ui';

export interface TrendPoint {
  period: string;
  label: string;
  opened: number;
  approved: number;
  rejected: number;
  newClients: number;
}

export interface LineSeries {
  key: keyof Pick<TrendPoint, 'opened' | 'approved' | 'rejected' | 'newClients'>;
  label: string;
  color: string;
}

const PAD = { top: 16, right: 14, bottom: 30, left: 40 };

/**
 * Monotone cubic interpolation (Fritsch-Carlson): smooth, but the curve never
 * swings past the points it joins. These are counts - a smoothed line that
 * dipped below zero between two real months would be drawing data that does
 * not exist.
 */
export function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x || 1e-6;
    m[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i].x + h},${pts[i].y + h * t[i]} ${pts[i + 1].x - h},${pts[i + 1].y - h * t[i + 1]} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

/**
 * Monthly case flows as smooth lines on one shared y-axis - every series is a
 * count of cases, so the scale is honest and the gap between two lines is a
 * real quantity.
 *
 * The first series (the volume one) carries a soft wash to the baseline; the
 * others are lines only, so the fill never becomes the thing you read. Lines
 * draw themselves in once on arrival. A crosshair snaps to the nearest month on
 * hover, touch or the arrow keys and lists every series there - the value
 * leads, the series name follows. The same figures are one click away as a
 * table.
 */
export function GeniusLineChart({
  points,
  series,
  height = 300,
  area = true,
  legend = false,
}: {
  points: TrendPoint[];
  series: LineSeries[];
  height?: number;
  /** Wash under the first series. */
  area?: boolean;
  /** Draw the legend above the plot (when the panel header does not carry it). */
  legend?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    const innerW = Math.max(1, width - PAD.left - PAD.right);
    const innerH = height - PAD.top - PAD.bottom;
    const n = points.length;
    const maxRaw = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key] as number)));
    // Round the ceiling up to a friendly step, keeping one step of headroom
    // above the tallest point, so the gridline labels are numbers a person
    // can hold in their head.
    const step = niceStep(maxRaw / 4);
    const topTicks = Math.floor(maxRaw / step) + 1;
    const max = step * topTicks;
    const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
    const lines = series.map((s) => {
      const pts = points.map((p, i) => ({ x: x(i), y: y(p[s.key] as number) }));
      return { ...s, pts, d: monotonePath(pts) };
    });
    const ticks = Array.from({ length: topTicks + 1 }, (_, i) => ({ v: step * i, y: y(step * i) }));
    const baseline = y(0);
    const first = lines[0];
    const fill =
      first && first.pts.length > 1
        ? `${first.d} L${first.pts[first.pts.length - 1].x},${baseline} L${first.pts[0].x},${baseline} Z`
        : null;
    return { innerW, innerH, x, y, lines, ticks, baseline, fill };
  }, [width, height, points, series]);

  if (points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-[13px] text-ink-400">
        No trend data yet.
      </div>
    );
  }

  const n = points.length;
  const nearest = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * width;
    const ratio = (px - PAD.left) / Math.max(1, geom.innerW);
    return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
  };

  const onPointer = (e: PointerEvent<SVGSVGElement>) =>
    setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()));

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      setHover((h) => Math.max(0, Math.min(n - 1, (h ?? (dir > 0 ? -1 : n)) + dir)));
    } else if (e.key === 'Escape') setHover(null);
  };

  const active = hover;

  return (
    <div ref={wrapRef} className="relative w-full">
      {legend && <LineLegend series={series} className="mb-2" />}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full touch-pan-y overflow-visible rounded-md"
        role="img"
        tabIndex={0}
        aria-label={`Monthly trend of ${series.map((s) => s.label).join(', ')}, ${points[0]?.label} to ${points[n - 1]?.label}. Use the arrow keys to read each month, or open the table below.`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onFocus={() => setHover((h) => h ?? n - 1)}
        onBlur={() => setHover(null)}
      >
        <defs>
          {series[0] && (
            <linearGradient id={`${uid}-wash`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series[0].color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={series[0].color} stopOpacity="0" />
            </linearGradient>
          )}
        </defs>

        {/* Gridlines recede: solid hairlines in the line token. */}
        {geom.ticks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 10}
              y={t.y + 4}
              textAnchor="end"
              className="tnum fill-ink-400 text-[11px]"
            >
              {t.v}
            </text>
          </g>
        ))}

        {points.map((p, i) => (
          <text
            key={p.period}
            x={geom.x(i)}
            y={height - 8}
            textAnchor="middle"
            className={cx(
              'text-[11px] transition-colors',
              active === i ? 'fill-ink-800 font-medium' : 'fill-ink-400',
            )}
          >
            {p.label}
          </text>
        ))}

        {area && geom.fill && <path d={geom.fill} fill={`url(#${uid}-wash)`} className="chart-fade" />}

        {/* The crosshair sits under the marks so it never cuts across a line. */}
        {active !== null && (
          <line
            x1={geom.x(active)}
            x2={geom.x(active)}
            y1={PAD.top}
            y2={geom.baseline}
            stroke="var(--color-line-strong)"
            strokeWidth={1}
          />
        )}

        {geom.lines.map((ln, i) => (
          <path
            key={ln.key}
            d={ln.d}
            pathLength={1}
            fill="none"
            stroke={ln.color}
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="chart-draw"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}

        {/* Every month's mark, ringed in the card colour so it stays legible
            where lines cross; the active month's marks grow. */}
        {geom.lines.map((ln) => (
          <g key={ln.key} className="chart-fade">
            {ln.pts.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r={active === i ? 5.5 : 3.5}
                fill={ln.color}
                stroke="var(--color-paper)"
                strokeWidth={2}
                className="transition-[r] duration-150"
              />
            ))}
          </g>
        ))}
      </svg>

      {active !== null && (
        <ChartTooltip
          left={geom.x(active)}
          width={width}
          title={points[active].label}
          rows={series.map((s) => ({ key: s.key, color: s.color, label: s.label, value: points[active][s.key] as number }))}
        />
      )}

      <ChartTable
        caption={`${series.map((s) => s.label).join(', ')} by month`}
        head={['Month', ...series.map((s) => s.label)]}
        rows={points.map((p) => [p.label, ...series.map((s) => p[s.key] as number)])}
      />
    </div>
  );
}

/**
 * The hover readout every chart shares: one tooltip, every series at that
 * point. Values lead in strong ink; the series name follows, keyed by a short
 * stroke of its colour - never coloured text.
 */
export function ChartTooltip({
  left,
  width,
  title,
  rows,
  top = 0,
}: {
  /** The anchor's x, in chart pixels. */
  left: number;
  /** The chart's width, to keep the tooltip on the card. */
  width: number;
  title: string;
  rows: { key: string; color: string; label: string; value: number | string }[];
  top?: number;
}) {
  const half = 92;
  const x = Math.min(Math.max(left, half), Math.max(half, width - half));
  return (
    <div
      role="status"
      className="chart-tip pointer-events-none absolute z-10 min-w-[150px] -translate-x-1/2 rounded-lg border border-line bg-paper/95 px-3 py-2.5 shadow-pop backdrop-blur-sm"
      style={{ left: x, top }}
    >
      <p className="mb-1.5 text-[11.5px] font-medium text-ink-400">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
            <span className="tnum font-semibold text-ink-950">{r.value}</span>
            <span className="truncate text-ink-500">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The same numbers as a table: every value exactly, without reading a line or
 * hovering twelve times - and the relief any sub-3:1 series needs.
 */
export function ChartTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="group mt-3">
      <summary className="inline-flex list-none items-center gap-1 rounded-md text-[12.5px] font-medium text-brand-700 hover:underline [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Show these figures as a table</span>
        <span className="hidden group-open:inline">Hide the table</span>
      </summary>
      <div className="scroll-x mt-2">
        <table className="w-full min-w-[360px] text-left text-[12.5px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-ink-500">
              {head.map((h, i) => (
                <th key={h} scope="col" className={cx('py-1.5 pr-3 font-medium', i > 0 && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[0])} className="border-b border-line last:border-0">
                {r.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="py-1.5 pr-3 font-normal text-ink-600">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="tnum py-1.5 pr-3 text-right text-ink-900">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** The legend row: a line key per series, mirroring the marks. */
export function LineLegend({ series, className }: { series: LineSeries[]; className?: string }) {
  return (
    <ul className={cx('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
          <span className="h-[3px] w-3.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** 1, 2, 5, 10, 20, 50... - the steps people actually count in. */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return Math.max(1, Math.round(nice * pow));
}
