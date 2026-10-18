import Link from 'next/link';
import { ROLE_LABEL, describeAudit, type AuditEntryView, type Role } from '@crm/shared';
import { describeDevice } from '@/lib/device';
import { Avatar, cx } from '../ui';

type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'neutral';

/** Colour only where something changed or went wrong; looking and signing in stay quiet. */
function toneFor(action: string): Tone {
  if (action === 'user.sign_in_failed' || action === 'mfa.challenge_failed') return 'bad';
  if (action.endsWith('.rejected') || action.endsWith('.deleted') || action.endsWith('.voided')) return 'bad';
  if (action.endsWith('.verified') || action.endsWith('.stage_advanced') || action === 'payment.recorded') return 'ok';
  if (
    action.startsWith('permission.') ||
    action.startsWith('security.') ||
    action === 'mfa.reset' ||
    action === 'mfa.disabled' ||
    action === 'staff.deactivated' ||
    action === 'staff.password_reset' ||
    action === 'data.exported' ||
    action.endsWith('.reassigned') ||
    action.endsWith('.stage_overridden')
  ) {
    return 'warn';
  }
  if (action.endsWith('.viewed') || action === 'document.downloaded') return 'neutral';
  return 'info';
}

const DOT: Record<Tone, string> = {
  ok: 'bg-ok-500',
  bad: 'bg-bad-500',
  warn: 'bg-warn-500',
  info: 'bg-info-500',
  neutral: 'bg-ink-300',
};

function when(iso: string) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

/**
 * The trail as sentences: "Viewed Ali Khan's record", with who, from where
 * and on what, and the exact time. Grouped by day so a morning's work reads
 * as one block. Built to settle a question months later, so nothing is
 * summarised away.
 */
export function AuditList({
  items,
  base,
  showActor = true,
}: {
  items: AuditEntryView[];
  /** Where client links go. */
  base: '/overview' | '/desk';
  /** Off on a member's own activity page, where every row is them. */
  showActor?: boolean;
}) {
  const groups: { day: string; rows: AuditEntryView[] }[] = [];
  for (const e of items) {
    const day = when(e.createdAt).day;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(e);
    else groups.push({ day, rows: [e] });
  }

  return (
    <div>
      {groups.map((g) => (
        <section key={g.day}>
          <h3 className="border-b border-line bg-ink-50 px-4 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-400 sm:px-5">
            {g.day}
          </h3>
          <ul className="divide-y divide-line">
            {g.rows.map((e) => {
              const t = when(e.createdAt);
              const device = describeDevice(e.userAgent);
              const actor = e.actorName ?? (e.action === 'user.sign_in_failed' ? 'Someone' : 'System');
              const tone = toneFor(e.action);
              return (
                <li key={e.id} className="flex gap-3 px-4 py-3 sm:px-5">
                  {showActor ? (
                    <span className="relative mt-0.5 shrink-0">
                      <Avatar name={actor} size={32} />
                      <span
                        aria-hidden
                        className={cx('absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-paper', DOT[tone])}
                      />
                    </span>
                  ) : (
                    <span aria-hidden className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', DOT[tone])} />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-snug text-ink-900">
                      {showActor && <span className="font-semibold">{actor} </span>}
                      <span className={showActor ? 'text-ink-700' : 'text-ink-900'}>
                        {showActor ? lowerFirst(describeAudit(e)) : describeAudit(e)}
                      </span>
                      {e.clientId && e.clientName && (
                        <>
                          {' '}
                          <Link
                            href={`${base}/clients/${e.clientId}`}
                            className="whitespace-nowrap text-[12.5px] font-medium text-brand-700 hover:underline"
                          >
                            Open client
                          </Link>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-ink-400">
                      {showActor && e.actorRole && <span>{ROLE_LABEL[e.actorRole as Role] ?? e.actorRole}</span>}
                      {e.ipAddress && (
                        <span className="tnum" title="IP address">
                          {e.ipAddress}
                        </span>
                      )}
                      {device && <span title={e.userAgent ?? undefined}>{device}</span>}
                    </p>
                  </div>

                  <time
                    dateTime={e.createdAt}
                    className="tnum shrink-0 pt-0.5 text-right text-[12px] text-ink-400"
                    title={new Date(e.createdAt).toLocaleString('en-GB')}
                  >
                    {t.time}
                  </time>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function lowerFirst(s: string) {
  // "Viewed Ali's record" reads as "Ayesha viewed Ali's record" after a name.
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}
