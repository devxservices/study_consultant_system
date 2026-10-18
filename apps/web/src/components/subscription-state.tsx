import type { SubscriptionState, SubscriptionStatus } from '@crm/shared';
import { formatDate } from '@/lib/format';
import { Pill, type Tone } from './ui';

/** Where a subscription stands, in one word and a colour - the same everywhere it is shown. */
export function subscriptionLabel(state: SubscriptionState, status: SubscriptionStatus): { label: string; tone: Tone } {
  if (state.access === 'read_only') return { label: 'Read-only', tone: 'bad' };
  if (state.access === 'grace') return { label: 'Payment overdue', tone: 'warn' };
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
  if (state.endingSoon) return { label: status === 'trialing' ? 'Trial ending' : 'Renews soon', tone: 'warn' };
  if (status === 'trialing') return { label: 'Trial', tone: 'info' };
  return { label: 'Paid up', tone: 'ok' };
}

export function SubscriptionPill({ state, status }: { state: SubscriptionState; status: SubscriptionStatus }) {
  const { label, tone } = subscriptionLabel(state, status);
  return (
    <Pill tone={tone} dot>
      {label}
    </Pill>
  );
}

/** "Paid until 1 Nov", "Trial until 1 Nov", "No end date". */
export function paidUntilText(state: SubscriptionState, status: SubscriptionStatus): string {
  if (!state.paidUntil) return 'No end date';
  return `${status === 'trialing' ? 'Trial until' : status === 'cancelled' ? 'Ends' : 'Paid until'} ${formatDate(state.paidUntil)}`;
}
