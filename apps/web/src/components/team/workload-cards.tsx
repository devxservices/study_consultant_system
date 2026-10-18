import Link from 'next/link';
import { Avatar, Card, Meter, Pill, cx, loadTone } from '../ui';
import { IconChevronRight } from '../icons';
import { StaffActions } from '../staff-actions';

export interface ConsultantSummary {
  id: string;
  userId: string;
  name: string;
  email: string;
  countries: string[];
  activeClients: number;
  maxActiveClients: number;
  pendingReviews: number;
  stuckCases: number;
  active: boolean;
}

/**
 * One card per consultant: how many clients, how much is waiting on them, how
 * close to capacity. Busiest first - the reason to open this is to find who
 * needs help.
 */
export function WorkloadCards({
  consultants,
  clientsHref,
  memberHref,
  canManage,
}: {
  consultants: ConsultantSummary[];
  /** Where a consultant's name leads: their client list, when the viewer may see it. */
  clientsHref?: (c: ConsultantSummary) => string;
  /** The owner's page for this person, managers only. */
  memberHref?: (c: ConsultantSummary) => string;
  /** Show capacity, password and login controls. */
  canManage: boolean;
}) {
  const ordered = [...consultants].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      b.activeClients / Math.max(1, b.maxActiveClients) - a.activeClients / Math.max(1, a.maxActiveClients),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {ordered.map((c) => {
        const load = Math.min(100, Math.round((c.activeClients / Math.max(1, c.maxActiveClients)) * 100));
        const heading = (
          <>
            <Avatar name={c.name} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium text-ink-950 group-hover:text-brand-700">{c.name}</p>
              <p className="truncate text-[12px] text-ink-400">{c.email}</p>
            </div>
            {!c.active && <Pill tone="neutral">Login off</Pill>}
          </>
        );
        return (
          <Card key={c.id} className={cx('lift p-4 sm:p-5', !c.active && 'opacity-70')}>
            {clientsHref ? (
              <Link href={clientsHref(c)} className="group flex items-center gap-2.5">
                {heading}
                <IconChevronRight size={16} className="shrink-0 text-ink-300" />
              </Link>
            ) : (
              <div className="flex items-center gap-2.5">{heading}</div>
            )}

            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3.5">
              <Figure label="Clients" value={c.activeClients} />
              <Figure label="To review" value={c.pendingReviews} tone="warn" />
              <Figure label="Stalled" value={c.stuckCases} tone="bad" />
            </dl>

            <div className="mt-4">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[12px] text-ink-400">
                  Capacity &middot; {c.activeClients} of {c.maxActiveClients}
                </span>
                <span className="tnum text-[12px] font-medium text-ink-600">{load}%</span>
              </div>
              <Meter value={load} tone={loadTone(load)} label={`${c.name} workload`} />
            </div>

            {(canManage || memberHref) && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                {canManage && (
                  <StaffActions consultantId={c.id} name={c.name} email={c.email} active={c.active} maxActiveClients={c.maxActiveClients} />
                )}
                {memberHref && (
                  <Link href={memberHref(c)} className="text-[12.5px] font-medium text-brand-700 hover:underline">
                    Permissions and activity
                  </Link>
                )}
              </div>
            )}

            {c.countries.length > 0 && (
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {c.countries.map((x) => (
                  <Pill key={x} tone="neutral">
                    {x}
                  </Pill>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/**
 * A figure only wears its tone when there is something there. A zero in the
 * stalled column is good news and colouring it red would say the opposite.
 */
function Figure({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  const colour = value === 0 || !tone ? 'text-ink-950' : tone === 'warn' ? 'text-warn-700' : 'text-bad-700';
  return (
    <div>
      <dt className="text-[12px] text-ink-400">{label}</dt>
      <dd className={cx('tnum text-[18px] font-semibold leading-6', colour)}>{value}</dd>
    </div>
  );
}
