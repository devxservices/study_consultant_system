import type { Tone } from '../ui';

const FILL: Record<Tone, string> = {
  ok: 'var(--color-ok-500)',
  warn: 'var(--color-warn-500)',
  bad: 'var(--color-bad-500)',
  neutral: 'var(--color-ink-400)',
  info: 'var(--color-series-1)',
};

/** The unfilled track: a pale step of the fill's own ramp, so the state reads around the whole ring. */
const TRACK: Record<Tone, string> = {
  ok: 'var(--color-ok-100)',
  warn: 'var(--color-warn-100)',
  bad: 'var(--color-bad-100)',
  neutral: 'var(--color-ink-100)',
  info: 'color-mix(in oklab, var(--color-series-1) 14%, var(--color-paper))',
};

/**
 * One ratio against its limit, bent into a ring - a meter, not a pie: there
 * is exactly one quantity, and the figure in the middle states it, so the arc
 * is never the only way to read it. The tone carries severity the same way
 * every meter in the product does. Sweeps in once on arrival.
 */
export function RingMeter({
  value,
  tone = 'info',
  size = 128,
  stroke = 11,
  label,
  caption,
  inverse = false,
}: {
  /** 0 to 100. */
  value: number;
  tone?: Tone;
  size?: number;
  stroke?: number;
  /** Accessible name, e.g. "Cases on track". */
  label: string;
  /** Small print under the figure, inside the ring. */
  caption?: string;
  /** White on a coloured card, instead of the tone on paper. */
  inverse?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="meter"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={inverse ? 'rgb(255 255 255 / 0.22)' : TRACK[tone]}
            strokeWidth={stroke}
          />
          {pct > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={inverse ? '#ffffff' : FILL[tone]}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c}`}
              className="chart-arc"
              style={{ ['--arc-c' as string]: c }}
            />
          )}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span
          className={inverse ? 'font-medium leading-none tracking-[-0.02em] text-white' : 'font-medium leading-none tracking-[-0.02em] text-ink-950'}
          style={{ fontSize: Math.round(size * 0.2) }}
        >
          {pct}
          <span className={inverse ? 'text-[0.55em] font-normal text-white/70' : 'text-[0.55em] font-normal text-ink-400'}>%</span>
        </span>
        {caption && (
          <span className={inverse ? 'mt-1 max-w-[80%] text-[11px] leading-tight text-white/75' : 'mt-1 max-w-[80%] text-[11px] leading-tight text-ink-400'}>
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
