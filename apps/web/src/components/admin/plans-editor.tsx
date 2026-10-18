'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CURRENCIES, MODULES, MODULE_LABEL, formatMoney, parseMoney, type Module, type PlanView } from '@crm/shared';
import { Button, Card, Pill, cx } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextInput } from '../forms';
import { IconCheck, IconClose } from '../icons';

const limitText = (n: number | null, unit: string) => (n === null ? `Unlimited ${unit}` : `${n.toLocaleString()} ${unit}`);

/**
 * The subscription tiers. Changing a plan changes it for every consultancy on
 * it at once - that is the point of plans rather than per-consultancy
 * switches - so the card says how many that is.
 */
export function PlansEditor({ plans }: { plans: PlanView[] }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {plans.map((p) => (
          <Card key={p.id} className={cx('flex flex-col p-5', !p.active && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[16px] font-semibold text-ink-950">{p.name}</p>
                <p className="font-mono text-[12px] text-ink-400">{p.code}</p>
              </div>
              {!p.active && <Pill tone="neutral">Retired</Pill>}
            </div>
            <p className="tnum mt-3 text-[28px] font-semibold text-ink-950">
              {formatMoney(p.priceMonthly, p.currency)}
              <span className="text-[13px] font-normal text-ink-400"> / month</span>
            </p>
            <ul className="mt-4 space-y-1.5 text-[13px] text-ink-700">
              <li>{limitText(p.maxStaff, 'staff')}</li>
              <li>{limitText(p.maxActiveClients, 'active clients')}</li>
              <li>{p.storageGb === null ? 'Unlimited storage' : `${p.storageGb} GB storage`}</li>
            </ul>
            <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-[13px]">
              {MODULES.map((m) => {
                const on = p.modules.includes(m);
                return (
                  <li key={m} className={cx('flex items-center gap-2', on ? 'text-ink-800' : 'text-ink-300')}>
                    {on ? <IconCheck size={15} className="text-ok-600" /> : <IconClose size={15} />}
                    {MODULE_LABEL[m]}
                  </li>
                );
              })}
            </ul>
            <div className="mt-auto flex items-center justify-between pt-5">
              <span className="text-[12.5px] text-ink-500">
                {p.tenantCount} consultanc{p.tenantCount === 1 ? 'y' : 'ies'}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setEditing(p.id)}>
                Edit
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {editing ? (
        <Card className="p-5">
          <PlanForm
            key={editing}
            initial={editing === 'new' ? null : (plans.find((p) => p.id === editing) ?? null)}
            onDone={() => setEditing(null)}
          />
        </Card>
      ) : (
        <Button onClick={() => setEditing('new')}>Add a plan</Button>
      )}
    </div>
  );
}

function PlanForm({ initial, onDone }: { initial: PlanView | null; onDone: () => void }) {
  const router = useRouter();
  const [v, setV] = useState({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    price: initial ? String(initial.priceMonthly / 100) : '',
    currency: initial?.currency ?? 'USD',
    maxStaff: initial?.maxStaff?.toString() ?? '',
    maxActiveClients: initial?.maxActiveClients?.toString() ?? '',
    storageGb: initial?.storageGb?.toString() ?? '',
    active: initial?.active ?? true,
  });
  const [modules, setModules] = useState<Module[]>(initial?.modules ?? [...MODULES]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (value: string) => setV((p) => ({ ...p, [k]: value }));
  const lim = (s: string) => (s.trim() ? Number(s) : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const price = parseMoney(v.price);
    if (price === null) {
      setErrors({ priceMonthly: 'Enter a price, like 99' });
      return;
    }
    setBusy(true);
    setErrors({});
    setError(null);
    const res = await callApi(initial ? `/api/admin/plans/${initial.id}` : '/api/admin/plans', {
      method: initial ? 'PATCH' : 'POST',
      json: {
        code: v.code.trim(),
        name: v.name.trim(),
        priceMonthly: price,
        currency: v.currency,
        maxStaff: lim(v.maxStaff),
        maxActiveClients: lim(v.maxActiveClients),
        storageGb: lim(v.storageGb),
        modules,
        active: v.active,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message);
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <h2 className="text-[15px] font-semibold text-ink-950">{initial ? `Edit ${initial.name}` : 'New plan'}</h2>
      {initial && initial.tenantCount > 0 && (
        <p className="text-[12.5px] text-warn-700">
          {initial.tenantCount} consultanc{initial.tenantCount === 1 ? 'y is' : 'ies are'} on this plan and will get these changes immediately.
        </p>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Name" required error={errors.name}>
          <TextInput value={v.name} onChange={set('name')} placeholder="Standard" invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Code" required error={errors.code} hint="Lowercase, never shown to customers">
          <TextInput value={v.code} onChange={set('code')} placeholder="standard" invalid={Boolean(errors.code)} />
        </Field>
        <Field label="Price per month" required error={errors.priceMonthly}>
          <TextInput value={v.price} onChange={set('price')} inputMode="decimal" placeholder="99" invalid={Boolean(errors.priceMonthly)} />
        </Field>
        <Field label="Currency">
          <SelectInput value={v.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Staff accounts" hint="Empty = unlimited" error={errors.maxStaff}>
          <TextInput value={v.maxStaff} onChange={set('maxStaff')} inputMode="numeric" />
        </Field>
        <Field label="Active clients" hint="Empty = unlimited" error={errors.maxActiveClients}>
          <TextInput value={v.maxActiveClients} onChange={set('maxActiveClients')} inputMode="numeric" />
        </Field>
        <Field label="Storage (GB)" hint="Empty = unlimited" error={errors.storageGb}>
          <TextInput value={v.storageGb} onChange={set('storageGb')} inputMode="numeric" />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2.5 text-[13.5px] text-ink-700">
          <input type="checkbox" checked={v.active} onChange={(e) => setV((p) => ({ ...p, active: e.target.checked }))} className="size-4 accent-brand-700" />
          Available for new consultancies
        </label>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink-700">Modules included</legend>
        <div className="flex flex-wrap gap-2">
          {MODULES.map((m) => {
            const on = modules.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => setModules((ms) => (on ? ms.filter((x) => x !== m) : [...ms, m]))}
                className={cx(
                  'h-9 rounded-full border px-3.5 text-[13px] font-medium',
                  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-paper text-ink-600',
                )}
              >
                {MODULE_LABEL[m]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save plan'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
