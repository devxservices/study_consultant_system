/**
 * A sparkline for a stat card.
 *
 * Deliberately axis-less, label-less and static: it is the shape of the last
 * few months behind a figure, not a chart to read values off. The figure beside
 * it is the message, and the full numbers live in the trend chart on the same
 * page - so this one carries an `aria-hidden` and adds no hover layer that
 * would compete with the card being a link. It draws itself in once.
 */
export function Sparkline({
  values,
  tone = 'info',
  width = 96,
  height = 34,
}: {
  values: number[];
  tone?: 'info' | 'ok' | 'warn' | 'bad';
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const color = {
    info: 'var(--color-series-1)',
    ok: 'var(--color-ok-500)',
    warn: 'var(--color-warn-500)',
    bad: 'var(--color-bad-500)',
  }[tone];

  const max = Math.max(1, ...values);
  const pad = 4;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
  const area = `${line} L ${x(values.length - 1)} ${height} L ${x(0)} ${height} Z`;
  const lastIndex = values.length - 1;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false" className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${tone})`} className="chart-fade" />
      <path
        d={line}
        pathLength={1}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="chart-draw"
      />
      <circle
        cx={x(lastIndex)}
        cy={y(values[lastIndex] ?? 0)}
        r="3.5"
        fill={color}
        stroke="var(--color-paper)"
        strokeWidth="2"
        className="chart-fade"
      />
    </svg>
  );
}
