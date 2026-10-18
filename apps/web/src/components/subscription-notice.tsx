import Link from 'next/link';
import type { AuthUser } from '@crm/shared';
import { getEntitlements } from '@/lib/entitlements';
import { formatDate } from '@/lib/format';
import { cx } from './ui';

/**
 * A line above every staff screen when the consultancy's subscription needs
 * attention. Managers hear about it a week ahead, since they are the ones who
 * pay; consultants only once it affects them (read-only), with no link to a
 * page they cannot open.
 */
export async function SubscriptionNotice({ user }: { user: AuthUser }) {
  const e = await getEntitlements();
  const s = e?.subscription;
  if (!s || (user.role !== 'manager' && user.role !== 'consultant')) return null;
  const manager = user.role === 'manager';

  let tone: 'info' | 'warn' | 'bad';
  let text: string;
  if (s.access === 'read_only') {
    tone = 'bad';
    text = manager
      ? `Your subscription ended on ${formatDate(s.paidUntil)}, so records are read-only: everyone can still see, export and reply to students, but not add or change anything. Renew it to carry on.`
      : 'Records are read-only until your consultancy renews its subscription. You can still see everything, export and reply to students.';
  } else if (s.access === 'grace' && manager) {
    tone = 'warn';
    text = s.graceEndsOn
      ? `Your subscription payment is overdue. Everything works until ${formatDate(s.graceEndsOn)}; after that records become read-only until it is renewed.`
      : 'Your subscription payment is marked overdue. Renew it to keep everything running.';
  } else if (s.endingSoon && manager) {
    tone = 'info';
    text = `Your subscription is paid until ${formatDate(s.paidUntil)}${s.daysLeft === 0 ? ' (today)' : s.daysLeft === 1 ? ' (tomorrow)' : ''}. Renew before then to avoid a break.`;
  } else {
    return null;
  }

  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cx(
        'mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg px-4 py-3 text-[13.5px] ring-1',
        tone === 'bad' && 'bg-bad-50 text-bad-700 ring-bad-200',
        tone === 'warn' && 'bg-warn-50 text-warn-700 ring-warn-200',
        tone === 'info' && 'bg-info-50 text-info-700 ring-info-200',
      )}
    >
      <p className="min-w-0 flex-1">{text}</p>
      {manager && (
        <Link href="/overview/subscription" className="shrink-0 font-medium underline underline-offset-2">
          See how to renew
        </Link>
      )}
    </div>
  );
}
