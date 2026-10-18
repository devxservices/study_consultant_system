'use client';

import { GeniusLineChart, type LineSeries, type TrendPoint } from './genius-line-chart';

export type { TrendPoint } from './genius-line-chart';

const SERIES: LineSeries[] = [
  { key: 'opened', label: 'Cases opened', color: 'var(--color-series-1)' },
  { key: 'approved', label: 'Visas approved', color: 'var(--color-series-2)' },
];

/**
 * Cases opened against visas approved, one point per month - the consultant's
 * own intake and what came of it.
 *
 * One y-axis, always: both series are counts of cases, so they share a scale
 * and the gap between the lines is a real quantity rather than an artefact of
 * two arbitrary axes. Opened carries the wash, as the volume series.
 */
export function TrendAreaChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return null;
  return <GeniusLineChart points={points} series={SERIES} height={260} legend />;
}
