import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx, type Tone } from './ui';

export interface SummaryRow {
  key: string;
  label: string;
  value: ReactNode;
  tone: Tone;
  href?: string;
}

/** The figure's status, on its marker disc and in its own colour. */
const DOT: Record<Tone, string> = {
  ok: 'bg-ok-50 text-ok-600 ring-ok-200',
  warn: 'bg-warn-50 text-warn-600 ring-warn-200',
  bad: 'bg-bad-50 text-bad-600 ring-bad-200',
  neutral: 'bg-ink-100 text-ink-400 ring-ink-200',
  info: 'bg-info-50 text-info-600 ring-info-200',
};

const VALUE: Record<Tone, string> = {
  ok: 'text-ok-700',
  warn: 'text-warn-700',
  bad: 'text-bad-700',
  neutral: 'text-ink-700',
  info: 'text-info-700',
};

/**
 * A short list of operational figures, laid out as the reference's soft grey
 * rows: a marker, the label in strong ink, and the figure in its status
 * colour - green because it is money received, red because it is overdue -
 * while the label always says so in words. Each row opens the list behind it.
 */
export function SummaryList({ rows }: { rows: SummaryRow[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className={cx('flex size-9 shrink-0 items-center justify-center rounded-full ring-1', DOT[r.tone])}
              >
                <span className="size-2.5 rounded-full bg-current" />
              </span>
              <span className="truncate text-[14px] font-semibold text-ink-950">{r.label}</span>
            </span>
            <span className={cx('tnum shrink-0 text-[14px] font-bold', VALUE[r.tone])}>{r.value}</span>
          </>
        );
        const className = cx(
          'flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3.5 py-3',
          r.href && 'press hover:bg-ink-100',
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className={className}>
                {inner}
              </Link>
            ) : (
              <div className={className}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
