'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  MODULES,
  MODULE_LABEL,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABEL,
  type Entitlements,
  type PlanView,
} from '@crm/shared';
import { Button, Card, Meter, Pill, loadTone } from '../ui';
import { SubscriptionPill, paidUntilText } from '../subscription-state';
import { callApi, Field, SelectInput, TextInput } from '../forms';
import { formatBytes } from '@/lib/format';

/**
 * Which plan a consultancy is on, whether it is paid up, and how close it is
 * to the plan's limits. No plan keeps every module on with no limits - the
 * behaviour consultancies had before plans existed.
 */
export function TenantSubscription({
  tenantId,
  planId,
  entitlements,
  plans,
}: {
  tenantId: string;
  planId: string | null;
  entitlements: Entitlements;
  plans: PlanView[];
}) {
  const router = useRouter();
  const [plan, setPlan] = useState(planId ?? '');
  const [status, setStatus] = useState<string>(entitlements.subscriptionStatus);
  const [periodEnd, setPeriodEnd] = useState(entitlements.currentPeriodEnd ?? '');
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setNote(null);
    const res = await callApi(`/api/admin/tenants/${tenantId}/subscription`, {
      method: 'POST',
      json: { planId: plan || null, subscriptionStatus: status, currentPeriodEnd: periodEnd || null },
    });
    setBusy(false);
    if (!res.ok) {
      setNote({ tone: 'bad', text: res.message ?? 'Could not save.' });
      return;
    }
    setNote({ tone: 'ok', text: 'Saved. The consultancy sees the change on its next page load.' });
    router.refresh();
  }

  const { limits, usage } = entitlements;
  const meters: [string, number, number | null, (n: number) => string][] = [
    ['Staff', usage.staff, limits.maxStaff, (n) => String(n)],
    ['Active clients', usage.activeClients, limits.maxActiveClients, (n) => String(n)],
    ['Storage', usage.storageBytes, limits.storageGb === null ? null : limits.storageGb * 1024 ** 3, formatBytes],
  ];

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink-950">Subscription</h2>
        <SubscriptionPill state={entitlements.subscription} status={entitlements.subscriptionStatus} />
      </div>
      <p className="mt-1 text-[13px] text-ink-500">{paidUntilText(entitlements.subscription, entitlements.subscriptionStatus)}</p>

      <div className="mt-4 space-y-3">
        {meters.map(([label, used, max, fmt]) => {
          const pct = max ? Math.round((used / max) * 100) : 0;
          return (
            <div key={label}>
              <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                <span className="text-ink-500">{label}</span>
                <span className="tnum font-medium text-ink-800">
                  {fmt(used)} {max === null ? '· unlimited' : `of ${fmt(max)}`}
                </span>
              </div>
              {max !== null && <Meter value={Math.min(100, pct)} tone={loadTone(pct)} label={`${label} used`} />}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[12px] font-medium uppercase tracking-wide text-ink-400">Modules</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {MODULES.map((m) => (
          <Pill key={m} tone={entitlements.modules.includes(m) ? 'ok' : 'neutral'}>
            {MODULE_LABEL[m]}
          </Pill>
        ))}
      </div>

      <div className="mt-5 space-y-3 border-t border-line pt-4">
        <Field label="Plan">
          <SelectInput
            value={plan}
            onChange={setPlan}
            placeholder="No plan - everything on, no limits"
            options={plans.filter((p) => p.active || p.id === planId).map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Billing status">
            <SelectInput value={status} onChange={setStatus} options={SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: SUBSCRIPTION_STATUS_LABEL[s] }))} />
          </Field>
          <Field label="Paid until">
            <TextInput type="date" value={periodEnd} onChange={setPeriodEnd} />
          </Field>
        </div>
        {note && <p className={note.tone === 'ok' ? 'text-[12.5px] text-ok-700' : 'text-[12.5px] text-bad-700'}>{note.text}</p>}
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save subscription'}
        </Button>
        <p className="text-[12px] text-ink-400">
          The renewal date decides access: once it and the grace days have passed, staff can still see, export and reply to students but not change records - students and partners carry on. Recording a payment moves the date on. To lock everyone out, suspend the consultancy below.
        </p>
      </div>
    </Card>
  );
}
