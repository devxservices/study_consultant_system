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

const ROW: Record<Tone, string> = {
  ok: 'bg-ok-50 text-ok-700',
  warn: 'bg-warn-50 text-warn-700',
  bad: 'bg-bad-50 text-bad-700',
  neutral: 'bg-ink-100 text-ink-600',
  info: 'bg-info-50 text-info-700',
};

/**
 * A short list of operational figures, each on a band of its own tone: what
 * came in, what is owed, what is late. The tone is the figure's status - it
 * is green because it is money received, red because it is overdue - and the
 * label always says so in words. Each band opens the list behind it.
 */
export function SummaryList({ rows }: { rows: SummaryRow[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full border-2 border-current" />
              <span className="truncate">{r.label}</span>
            </span>
            <span className="tnum shrink-0 rounded-md bg-paper/85 px-2 py-0.5 text-[13px] font-medium text-ink-900 shadow-[0_1px_1px_rgb(15_27_53/0.05)]">
              {r.value}
            </span>
          </>
        );
        const className = cx(
          'flex items-center justify-between gap-3 rounded-lg px-3.5 py-3',
          ROW[r.tone],
          r.href && 'press hover:brightness-[0.97]',
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
