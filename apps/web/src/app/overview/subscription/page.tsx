import { formatMoney, type MySubscriptionView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { getEntitlements } from '@/lib/entitlements';
import { requireRole } from '@/lib/session';
import { formatBytes, formatDate } from '@/lib/format';
import { Card, Meter, PageHeader, Panel, loadTone } from '@/components/ui';
import { SubscriptionPill, paidUntilText } from '@/components/subscription-state';
import { SubscriptionPayments } from '@/components/subscription-payments';

export const metadata = { title: 'Subscription' };

/**
 * The consultancy's own account with the platform, for its manager: the plan,
 * how far it is used, the date it is paid until, how to pay, and receipts.
 */
export default async function SubscriptionPage() {
  await requireRole('manager');
  const [sub, entitlements] = await Promise.all([apiFetch<MySubscriptionView>('/tenancy/subscription'), getEntitlements()]);
  const { state } = sub;
  const platform = sub.operatorName || 'the platform';

  const explain =
    state.access === 'read_only'
      ? `The subscription ended on ${formatDate(state.paidUntil)}. Everyone can still sign in, see and export everything and reply to students, but records cannot be added or changed until a payment is recorded. Students and partners are not affected.`
      : state.access === 'grace'
        ? state.graceEndsOn
          ? `The payment is overdue. Everything keeps working until ${formatDate(state.graceEndsOn)}; after that records become read-only until it is renewed.`
          : 'The payment is marked overdue. Renew to keep everything running.'
        : !state.paidUntil
          ? 'There is no end date on your subscription.'
          : sub.status === 'cancelled'
            ? `The subscription is cancelled and runs until ${formatDate(state.paidUntil)}.`
            : `Everything is paid until ${formatDate(state.paidUntil)}${state.daysLeft !== null ? ` - ${state.daysLeft === 0 ? 'today is the last day' : state.daysLeft === 1 ? '1 day left' : `${state.daysLeft} days left`}` : ''}. Renew before then to avoid a break.`;

  const limits = entitlements?.limits;
  const usage = entitlements?.usage;
  const meters: [string, number, number | null, (n: number) => string][] =
    limits && usage
      ? [
          ['Staff', usage.staff, limits.maxStaff, (n) => String(n)],
          ['Active clients', usage.activeClients, limits.maxActiveClients, (n) => String(n)],
          ['Document storage', usage.storageBytes, limits.storageGb === null ? null : limits.storageGb * 1024 ** 3, formatBytes],
        ]
      : [];

  return (
    <>
      <PageHeader title="Subscription" subtitle={`Your consultancy’s plan with ${platform}, what is paid, and how to pay.`} />
      <div className="grid items-start gap-5 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[12.5px] text-ink-500">Plan</p>
                <p className="text-[18px] font-semibold text-ink-950">{sub.planName ?? 'Standard'}</p>
                {sub.priceMonthly !== null && sub.currency && (
                  <p className="tnum text-[13px] text-ink-500">{formatMoney(sub.priceMonthly, sub.currency)} a month</p>
                )}
              </div>
              <div className="text-right">
                <SubscriptionPill state={state} status={sub.status} />
                <p className="mt-1.5 text-[13px] text-ink-600">{paidUntilText(state, sub.status)}</p>
              </div>
            </div>
            <p className="mt-4 border-t border-line pt-3 text-[13.5px] leading-relaxed text-ink-700">{explain}</p>
          </Card>

          <Panel title="Payments" subtitle="Each payment and the period it covers. A receipt is emailed to every manager.">
            <SubscriptionPayments payments={sub.payments} />
          </Panel>
        </div>

        <div className="space-y-5">
          <Card className="p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold text-ink-950">How to pay</h2>
            {sub.paymentInstructions ? (
              <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-700">{sub.paymentInstructions}</p>
            ) : (
              <p className="mt-2 text-[13.5px] text-ink-500">Ask {platform} for payment details. Once your payment is recorded, this page and every screen update at once.</p>
            )}
          </Card>

          {meters.length > 0 && (
            <Card className="p-4 sm:p-5">
              <h2 className="text-[15px] font-semibold text-ink-950">What your plan allows</h2>
              <div className="mt-3 space-y-3">
                {meters.map(([label, used, max, fmt]) => {
                  const pct = max ? Math.round((used / max) * 100) : 0;
                  return (
                    <div key={label}>
                      <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                        <span className="text-ink-500">{label}</span>
                        <span className="tnum font-medium text-ink-800">
                          {fmt(used)} {max === null ? '· no limit' : `of ${fmt(max)}`}
                        </span>
                      </div>
                      {max !== null && <Meter value={Math.min(100, pct)} tone={loadTone(pct)} label={`${label} used`} />}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
