'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  CURRENCIES,
  GATEWAY_LABEL,
  GATEWAY_PROVIDERS,
  LATE_FEE_KINDS,
  bpToPercent,
  describePromo,
  type FinanceSettingsView,
  type PromoCodeView,
  type TaxRateView,
} from '@crm/shared';
import { Button, Card, Pill, cx } from '../ui';
import { callApi, Field, FormAlert, SelectInput, TextArea, TextInput } from '../forms';

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  async function save(url: string, method: 'POST' | 'PUT', json: unknown) {
    setBusy(true);
    setError(null);
    setErrors({});
    setSaved(false);
    const res = await callApi(url, { method, json });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors);
      setError(res.message ?? Object.values(res.fieldErrors)[0] ?? 'Could not save.');
      return false;
    }
    setSaved(true);
    router.refresh();
    return true;
  }
  return { busy, error, errors, saved, save };
}

export function GeneralSettingsForm({ settings, canEdit }: { settings: FinanceSettingsView; canEdit: boolean }) {
  const { busy, error, errors, saved, save } = useSave();
  const [f, setF] = useState({
    baseCurrency: settings.baseCurrency as string,
    bankDetails: settings.bankDetails ?? '',
    invoiceTerms: settings.invoiceTerms ?? '',
    discountApprovalPercent: settings.discountApprovalPercent === null ? '' : String(settings.discountApprovalPercent),
    directRefunds: settings.directRefunds,
    lateFeeKind: settings.lateFeeKind as string,
    lateFeeValue: settings.lateFeeKind === 'percent' ? String(bpToPercent(settings.lateFeeValue)) : String(settings.lateFeeValue / 100),
    lateFeeGraceDays: String(settings.lateFeeGraceDays),
    reminderOffsets: settings.reminderOffsets.join(', '),
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    await save('/api/finance/settings', 'PUT', {
      baseCurrency: f.baseCurrency,
      bankDetails: f.bankDetails || null,
      invoiceTerms: f.invoiceTerms || null,
      discountApprovalPercent: f.discountApprovalPercent === '' ? null : Number(f.discountApprovalPercent),
      directRefunds: f.directRefunds,
      lateFeeKind: f.lateFeeKind,
      lateFeeValue: Number(f.lateFeeValue) || 0,
      lateFeeGraceDays: Number(f.lateFeeGraceDays) || 0,
      reminderOffsets: f.reminderOffsets
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isInteger(n)),
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-5 xl:grid-cols-2">
      <Card className="space-y-4 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-ink-950">What invoices say</h2>
        <Field label="Base currency" hint="Reports convert other currencies into this one at each transaction’s rate.">
          <SelectInput value={f.baseCurrency} onChange={set('baseCurrency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="How to pay you" hint="Printed on every invoice: bank, account title, IBAN, branch, wallet numbers.">
          <TextArea value={f.bankDetails} onChange={set('bankDetails')} rows={4} placeholder={'Meezan Bank, Gulberg branch\nAccount title: Example Consultants\nIBAN: PK00 MEZN 0000 0000 0000 0000'} />
        </Field>
        <Field label="Terms" hint="The small print at the foot of invoices and quotes.">
          <TextArea value={f.invoiceTerms} onChange={set('invoiceTerms')} rows={3} placeholder="e.g. Fees are non-refundable once an application is submitted, except as set out in our refund policy." />
        </Field>
      </Card>
      <div className="space-y-5">
        <Card className="space-y-4 p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-ink-950">A second pair of eyes</h2>
          <Field label="Discounts above (%) need approval" hint="Leave empty for never. Someone with “Approve refunds and discounts” approves; never the person who gave it." error={errors.discountApprovalPercent}>
            <TextInput value={f.discountApprovalPercent} onChange={set('discountApprovalPercent')} inputMode="decimal" placeholder="e.g. 15" />
          </Field>
          <label className="flex items-start gap-2 text-[13px] text-ink-700">
            <input type="checkbox" className="mt-0.5" checked={f.directRefunds} onChange={(e) => set('directRefunds')(e.target.checked)} />
            Managers may record a refund straight away. Untick to send every refund through a request and approval.
          </label>
        </Card>
        <Card className="space-y-4 p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-ink-950">Reminders and late fees</h2>
          <Field label="Remind students (days from the due date)" hint="−3 is three days before, 0 the day, 7 a week late. Each goes once per due date." error={errors.reminderOffsets}>
            <TextInput value={f.reminderOffsets} onChange={set('reminderOffsets')} placeholder="-3, 0, 7, 14" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Late fee">
              <SelectInput value={f.lateFeeKind} onChange={set('lateFeeKind')} options={LATE_FEE_KINDS.map((k) => ({ value: k, label: k === 'none' ? 'None' : k === 'fixed' ? 'Fixed amount' : 'Percent of what is late' }))} />
            </Field>
            {f.lateFeeKind !== 'none' && (
              <>
                <Field label={f.lateFeeKind === 'percent' ? 'Percent' : `Amount (${f.baseCurrency})`} error={errors.lateFeeValue}>
                  <TextInput value={f.lateFeeValue} onChange={set('lateFeeValue')} inputMode="decimal" />
                </Field>
                <Field label="After (days late)" error={errors.lateFeeGraceDays}>
                  <TextInput value={f.lateFeeGraceDays} onChange={set('lateFeeGraceDays')} inputMode="numeric" />
                </Field>
              </>
            )}
          </div>
          {f.lateFeeKind !== 'none' && <p className="text-[12px] text-ink-400">Charged once per installment (or per invoice), as its own invoice, and the student is told.</p>}
        </Card>
        {error && <FormAlert>{error}</FormAlert>}
        {saved && <FormAlert tone="ok">Saved.</FormAlert>}
        {canEdit && (
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        )}
      </div>
    </form>
  );
}

export function TaxesEditor({ taxes }: { taxes: TaxRateView[] }) {
  const { busy, error, save } = useSave();
  const [editing, setEditing] = useState<TaxRateView | 'new' | null>(null);
  const [f, setF] = useState({ name: '', ratePercent: '', inclusive: false, isDefault: false, active: true });
  const start = (t: TaxRateView | 'new') => {
    setEditing(t);
    setF(t === 'new' ? { name: '', ratePercent: '', inclusive: false, isDefault: false, active: true } : { name: t.name, ratePercent: String(t.ratePercent), inclusive: t.inclusive, isDefault: t.isDefault, active: t.active });
  };
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="overflow-hidden">
        {taxes.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-ink-400">No taxes. Invoices carry none until you add one.</p>
        ) : (
          <ul className="divide-y divide-line">
            {taxes.map((t) => (
              <li key={t.id} className={cx('flex items-center justify-between gap-3 px-5 py-3', !t.active && 'opacity-60')}>
                <div>
                  <p className="text-[14px] font-medium text-ink-950">
                    {t.name} <span className="tnum text-ink-500">{t.ratePercent}%</span>
                  </p>
                  <p className="text-[12px] text-ink-400">
                    {t.inclusive ? 'Included in prices' : 'Added on top'}
                    {t.isDefault ? ' · default on new lines' : ''}
                    {!t.active ? ' · switched off' : ''}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => start(t)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4 sm:p-5">
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(editing === 'new' ? '/api/finance/taxes' : `/api/finance/taxes/${editing.id}`, editing === 'new' ? 'POST' : 'PUT', { ...f, ratePercent: Number(f.ratePercent) });
              if (ok) setEditing(null);
            }}
          >
            <h2 className="text-[15px] font-semibold text-ink-950">{editing === 'new' ? 'New tax' : `Edit ${editing.name}`}</h2>
            <Field label="Name">
              <TextInput value={f.name} onChange={(v) => setF((x) => ({ ...x, name: v }))} placeholder="e.g. Punjab sales tax on services" />
            </Field>
            <Field label="Rate (%)">
              <TextInput value={f.ratePercent} onChange={(v) => setF((x) => ({ ...x, ratePercent: v }))} inputMode="decimal" />
            </Field>
            {[
              ['inclusive', 'Prices already include it'],
              ['isDefault', 'Put it on new lines by default'],
              ['active', 'In use'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-[13px] text-ink-700">
                <input type="checkbox" checked={f[k as 'active']} onChange={(e) => setF((x) => ({ ...x, [k!]: e.target.checked }))} /> {label}
              </label>
            ))}
            <p className="text-[12px] text-ink-400">Changing a rate never changes an invoice already issued.</p>
            {error && <FormAlert>{error}</FormAlert>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <h2 className="text-[15px] font-semibold text-ink-950">Taxes</h2>
            <p className="mt-1 text-[13px] text-ink-500">Sales tax on your services. What is charged is booked to Sales tax payable; what you reclaim on bills comes off it.</p>
            <Button className="mt-4" onClick={() => start('new')}>
              Add a tax
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

export function PromosEditor({ promos }: { promos: PromoCodeView[] }) {
  const { busy, error, errors, save } = useSave();
  const [editing, setEditing] = useState<PromoCodeView | 'new' | null>(null);
  const empty = { code: '', description: '', kind: 'percent', value: '', currency: 'PKR', validFrom: '', validTo: '', maxUses: '', active: true };
  const [f, setF] = useState(empty);
  const start = (p: PromoCodeView | 'new') => {
    setEditing(p);
    setF(
      p === 'new'
        ? empty
        : {
            code: p.code,
            description: p.description ?? '',
            kind: p.kind,
            value: p.kind === 'percent' ? String(bpToPercent(p.value)) : String(p.value / 100),
            currency: p.currency ?? 'PKR',
            validFrom: p.validFrom ?? '',
            validTo: p.validTo ?? '',
            maxUses: p.maxUses === null ? '' : String(p.maxUses),
            active: p.active,
          },
    );
  };
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="overflow-hidden">
        {promos.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-ink-400">No promotions yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {promos.map((p) => (
              <li key={p.id} className={cx('flex items-center justify-between gap-3 px-5 py-3', !p.active && 'opacity-60')}>
                <div>
                  <p className="font-mono text-[14px] font-medium text-ink-950">
                    {p.code} <span className="font-sans text-[13px] text-ink-500">{describePromo(p)}</span>
                  </p>
                  <p className="text-[12px] text-ink-400">
                    Used {p.uses}
                    {p.maxUses !== null ? ` of ${p.maxUses}` : ''} times
                    {p.validTo ? ` · until ${p.validTo}` : ''}
                    {p.description ? ` · ${p.description}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!p.active && <Pill tone="neutral">Off</Pill>}
                  <Button size="sm" variant="ghost" onClick={() => start(p)}>
                    Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4 sm:p-5">
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(editing === 'new' ? '/api/finance/promos' : `/api/finance/promos/${editing.id}`, editing === 'new' ? 'POST' : 'PUT', {
                code: f.code,
                description: f.description || null,
                kind: f.kind,
                value: Number(f.value),
                currency: f.kind === 'fixed' ? f.currency : null,
                validFrom: f.validFrom || null,
                validTo: f.validTo || null,
                maxUses: f.maxUses ? Number(f.maxUses) : null,
                active: f.active,
              });
              if (ok) setEditing(null);
            }}
          >
            <h2 className="text-[15px] font-semibold text-ink-950">{editing === 'new' ? 'New promotion' : `Edit ${editing.code}`}</h2>
            <Field label="Code" error={errors.code}>
              <TextInput value={f.code} onChange={(v) => setF((x) => ({ ...x, code: v.toUpperCase() }))} placeholder="e.g. EXPO2027" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kind">
                <SelectInput value={f.kind} onChange={(v) => setF((x) => ({ ...x, kind: v }))} options={[{ value: 'percent', label: 'Percent off' }, { value: 'fixed', label: 'Amount off' }]} />
              </Field>
              <Field label={f.kind === 'percent' ? 'Percent' : 'Amount'} error={errors.value}>
                <TextInput value={f.value} onChange={(v) => setF((x) => ({ ...x, value: v }))} inputMode="decimal" />
              </Field>
            </div>
            {f.kind === 'fixed' && (
              <Field label="Currency" error={errors.currency}>
                <SelectInput value={f.currency} onChange={(v) => setF((x) => ({ ...x, currency: v }))} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" hint="Optional">
                <TextInput type="date" value={f.validFrom} onChange={(v) => setF((x) => ({ ...x, validFrom: v }))} />
              </Field>
              <Field label="Until" hint="Optional" error={errors.validTo}>
                <TextInput type="date" value={f.validTo} onChange={(v) => setF((x) => ({ ...x, validTo: v }))} />
              </Field>
            </div>
            <Field label="Uses at most" hint="Optional">
              <TextInput value={f.maxUses} onChange={(v) => setF((x) => ({ ...x, maxUses: v.replace(/\D/g, '') }))} inputMode="numeric" />
            </Field>
            <Field label="Note" hint="Optional - who it is for">
              <TextInput value={f.description} onChange={(v) => setF((x) => ({ ...x, description: v }))} />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-ink-700">
              <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> In use
            </label>
            {error && <FormAlert>{error}</FormAlert>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <h2 className="text-[15px] font-semibold text-ink-950">Promotions</h2>
            <p className="mt-1 text-[13px] text-ink-500">Codes for events and campaigns: a percent or an amount off, for a while or a number of uses.</p>
            <Button className="mt-4" onClick={() => start('new')}>
              Add a promotion
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

export function GatewayForm({ settings }: { settings: FinanceSettingsView }) {
  const { busy, error, errors, saved, save } = useSave();
  const [provider, setProvider] = useState<string>(settings.gateway.provider);
  const [secret, setSecret] = useState('');
  const [webhook, setWebhook] = useState('');
  const [publishable, setPublishable] = useState(settings.gateway.stripePublishableKey ?? '');
  return (
    <form
      className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]"
      onSubmit={async (e) => {
        e.preventDefault();
        await save('/api/finance/settings/gateway', 'PUT', {
          provider,
          ...(secret ? { stripeSecretKey: secret.trim() } : {}),
          ...(webhook ? { stripeWebhookSecret: webhook.trim() } : {}),
          ...(publishable ? { stripePublishableKey: publishable.trim() } : {}),
        });
        setSecret('');
        setWebhook('');
      }}
    >
      <Card className="space-y-4 p-4 sm:p-5">
        <Field label="Students pay online with">
          <SelectInput
            value={provider}
            onChange={setProvider}
            options={GATEWAY_PROVIDERS.filter((g) => g !== 'test' || settings.gateway.testAllowed).map((g) => ({ value: g, label: GATEWAY_LABEL[g] }))}
          />
        </Field>
        {provider === 'stripe' && (
          <>
            <Field label="Secret key" hint={settings.gateway.stripeConfigured ? 'Stored, encrypted. Enter a new one only to replace it.' : 'From your Stripe dashboard: Developers → API keys.'} error={errors.stripeSecretKey}>
              <TextInput value={secret} onChange={setSecret} type="password" placeholder={settings.gateway.stripeConfigured ? '••••••••' : 'sk_live_…'} />
            </Field>
            <Field label="Webhook signing secret" hint="Stripe → Developers → Webhooks → add the endpoint below, for checkout.session.completed and checkout.session.expired." error={errors.stripeWebhookSecret}>
              <TextInput value={webhook} onChange={setWebhook} type="password" placeholder={settings.gateway.stripeConfigured ? '••••••••' : 'whsec_…'} />
            </Field>
            <Field label="Publishable key" hint="Optional">
              <TextInput value={publishable} onChange={setPublishable} placeholder="pk_live_…" />
            </Field>
            {settings.gateway.webhookUrl && (
              <div className="rounded-lg bg-ink-50 p-3 text-[12.5px] text-ink-700">
                Webhook endpoint: <span className="break-all font-mono">{settings.gateway.webhookUrl}</span>
              </div>
            )}
          </>
        )}
        {provider === 'test' && <p className="text-[12.5px] text-warn-700">Test mode: the student sees a pretend checkout with Pay and Cancel. No money moves. Refused on a live server.</p>}
        {error && <FormAlert>{error}</FormAlert>}
        {saved && <FormAlert tone="ok">Saved.</FormAlert>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </Card>
      <Card className="p-4 text-[12.5px] leading-relaxed text-ink-600 sm:p-5">
        <p className="font-medium text-ink-900">How it works</p>
        <p className="mt-1">
          The student presses Pay on their invoice and pays on the provider’s page. Money is recorded only when the provider confirms it - once, however often it confirms - into “Online payments”, with a receipt emailed straight away.
        </p>
        <p className="mt-2">JazzCash and Easypaisa: until you have merchant credentials, students pay by wallet and upload the screenshot as proof, which you check under To verify.</p>
        <p className="mt-2 text-ink-400">Keys are stored encrypted and never shown again. Current: {settings.gateway.stripeConfigured ? 'Stripe keys stored' : 'no Stripe keys'}.</p>
      </Card>
    </form>
  );
}
