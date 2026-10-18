import Link from 'next/link';
import { cx } from './ui';
import { IconCalendar, IconCap, IconGlobe, IconPassport, IconShield } from './icons';

export interface DeadlineItem {
  kind: 'application' | 'offer' | 'visa_appointment' | 'travel' | 'passport';
  date: string;
  caseId: string;
  reference: string;
  clientId: string;
  clientName: string;
  consultantName: string | null;
  targetCountry: string;
  targetUniversity: string | null;
}

const KIND: Record<DeadlineItem['kind'], { label: string; icon: React.ReactNode }> = {
  application: { label: 'Application deadline', icon: <IconCap size={16} /> },
  offer: { label: 'Accept offer by', icon: <IconCalendar size={16} /> },
  visa_appointment: { label: 'Visa appointment', icon: <IconShield size={16} /> },
  travel: { label: 'Travels', icon: <IconGlobe size={16} /> },
  passport: { label: 'Passport expires', icon: <IconPassport size={16} /> },
};

function daysFrom(date: string): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(new Date(`${date}T00:00:00`)) - start(new Date())) / 86_400_000);
}

/**
 * What is coming up, soonest first, with a missed one in red at the top. Each
 * row opens the case it belongs to.
 */
export function DeadlineList({
  items,
  hrefBase,
  showConsultant = false,
  limit = 8,
}: {
  items: DeadlineItem[];
  hrefBase: '/desk' | '/overview';
  showConsultant?: boolean;
  limit?: number;
}) {
  if (items.length === 0) {
    return <p className="px-4 pb-5 text-[13px] text-ink-400 sm:px-5">Nothing dated in the next few weeks.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {items.slice(0, limit).map((d, i) => {
        const days = daysFrom(d.date);
        const when =
          days < 0 ? `${-days}d ago` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`;
        const tone = days < 0 ? 'bad' : days <= 7 ? 'warn' : 'neutral';
        return (
          <li key={`${d.caseId}-${d.kind}-${i}`}>
            <Link
              href={d.kind === 'passport' ? `${hrefBase}/clients/${d.clientId}` : `${hrefBase}/cases/${d.caseId}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-50 sm:px-5"
            >
              <span
                className={cx(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  tone === 'bad' ? 'bg-bad-50 text-bad-700' : tone === 'warn' ? 'bg-warn-50 text-warn-700' : 'bg-ink-50 text-ink-500',
                )}
              >
                {KIND[d.kind].icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink-950">{d.clientName}</span>
                <span className="block truncate text-[12px] text-ink-400">
                  {KIND[d.kind].label}
                  {d.kind !== 'passport' ? ` · ${d.targetUniversity ?? d.targetCountry}` : ''}
                  {showConsultant && d.consultantName ? ` · ${d.consultantName}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="tnum block text-[12.5px] font-medium text-ink-800">
                  {new Date(`${d.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
                <span
                  className={cx(
                    'block text-[11.5px]',
                    tone === 'bad' ? 'font-medium text-bad-700' : tone === 'warn' ? 'text-warn-700' : 'text-ink-400',
                  )}
                >
                  {when}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
