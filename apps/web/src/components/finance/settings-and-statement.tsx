import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney, type AuthUser, type FinanceSettingsView, type PromoCodeView, type ServicePackageView, type StatementView, type TaxRateView } from '@crm/shared';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, PageHeader, cx } from '../ui';
import { NoAccess } from '../no-access';
import { PackagesEditor } from '../billing/packages-editor';
import { FinanceTabs, MoneyTable, pathsFor } from './workspace';
import { GatewayForm, GeneralSettingsForm, PromosEditor, TaxesEditor } from './settings-forms';

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'catalogue', label: 'Fee catalogue' },
  { key: 'taxes', label: 'Taxes' },
  { key: 'promotions', label: 'Promotions' },
  { key: 'payments', label: 'Online payments' },
] as const;

export async function FinanceSettingsPage({ user, tab: raw }: { user: AuthUser; tab?: string }) {
  const edit = can(user, 'finance.settings');
  if (!edit && !can(user, 'finance.ledger')) return <NoAccess title="Finance settings" permission="finance.settings" />;
  const p = pathsFor(user);
  const tab = TABS.some((t) => t.key === raw) ? raw! : 'general';
  const [settings, taxes, promos, packages] = await Promise.all([
    apiFetch<FinanceSettingsView>('/finance/settings'),
    apiFetch<TaxRateView[]>('/finance/taxes'),
    edit && tab === 'promotions' ? apiFetch<PromoCodeView[]>('/finance/promos') : Promise.resolve([] as PromoCodeView[]),
    tab === 'catalogue' ? apiFetch<ServicePackageView[]>('/billing/packages?all=true') : Promise.resolve([] as ServicePackageView[]),
  ]);
  const visible = TABS.filter((t) => edit || t.key === 'general');
  return (
    <>
      <PageHeader title="Finance settings" subtitle={edit ? 'How invoices read, who approves what, taxes, promotions and online payments.' : 'Read only - changing them needs “Finance settings”.'} />
      <FinanceTabs user={user} active="settings" />
      <div className="mb-4 flex flex-wrap gap-1.5 text-[12.5px]">
        {visible.map((t) => (
          <Link key={t.key} href={`${p.base}/settings${qs({ tab: t.key })}`} className={cx('rounded-full px-2.5 py-1 ring-1', tab === t.key ? 'bg-ink-900 text-paper ring-ink-900' : 'text-ink-600 ring-line hover:bg-ink-50')}>
            {t.label}
          </Link>
        ))}
      </div>
      {tab === 'general' && <GeneralSettingsForm settings={settings} canEdit={edit} />}
      {tab === 'catalogue' && edit && <PackagesEditor packages={packages} taxRates={taxes} />}
      {tab === 'taxes' && edit && <TaxesEditor taxes={taxes} />}
      {tab === 'promotions' && edit && <PromosEditor promos={promos} />}
      {tab === 'payments' && edit && <GatewayForm settings={settings} />}
    </>
  );
}

/** A student's account in one currency: what was billed, credited, paid and refunded. */
export async function StatementPage({ user, clientId, query, backHref }: { user: AuthUser; clientId?: string; query: { currency?: string; from?: string; to?: string }; backHref: string }) {
  const url = clientId ? `/billing/clients/${clientId}/statement` : '/billing/statement';
  let s: StatementView;
  try {
    s = await apiFetch<StatementView>(`${url}${qs(query)}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const pdf = `/api${url}/pdf${qs({ currency: s.currency, from: query.from, to: query.to })}`;
  return (
    <div>
      <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
        <span aria-hidden>&larr;</span> Back
      </Link>
      <PageHeader
        title={user.role === 'client' ? 'Your statement' : `Statement · ${s.clientName}`}
        subtitle={`${s.currency}${s.from ? `, from ${formatDate(s.from)}` : ''} to ${formatDate(s.to)}`}
        actions={
          <a href={pdf} className="inline-flex h-9.5 items-center rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] font-medium text-ink-800 hover:bg-ink-50">
            Download PDF
          </a>
        }
      />
      {s.currencies.length > 1 && (
        <div className="mb-3 flex gap-1.5 text-[12.5px]">
          {s.currencies.map((c) => (
            <Link key={c} href={qs({ ...query, currency: c })} className={cx('rounded-full px-2.5 py-1 ring-1', s.currency === c ? 'bg-ink-900 text-paper ring-ink-900' : 'text-ink-600 ring-line hover:bg-ink-50')}>
              {c}
            </Link>
          ))}
        </div>
      )}
      <Card className="overflow-hidden">
        <MoneyTable head={['Date', 'Reference', 'Details', { label: 'Charged', right: true }, { label: 'Paid or credited', right: true }, { label: 'Balance', right: true }]}>
          <tr className="border-t border-line bg-ink-50/50">
            <td className="px-4 py-2 text-ink-500" colSpan={5}>
              Brought forward
            </td>
            <td className="tnum px-4 py-2 text-right">{formatMoney(s.opening, s.currency)}</td>
          </tr>
          {s.lines.map((l, i) => (
            <tr key={i} className="border-t border-line">
              <td className="tnum whitespace-nowrap px-4 py-2 text-ink-500">{formatDate(l.date)}</td>
              <td className="whitespace-nowrap px-4 py-2 font-mono text-[12.5px]">
                {l.link ? (
                  <Link href={l.link} className="text-brand-700 hover:underline">
                    {l.reference}
                  </Link>
                ) : (
                  l.reference
                )}
              </td>
              <td className="px-4 py-2 text-ink-800">{l.description}</td>
              <td className="tnum px-4 py-2 text-right">{l.debit ? formatMoney(l.debit, s.currency) : ''}</td>
              <td className="tnum px-4 py-2 text-right text-ok-700">{l.credit ? formatMoney(l.credit, s.currency) : ''}</td>
              <td className="tnum px-4 py-2 text-right font-medium">{formatMoney(l.balance, s.currency)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-line">
            <td className="px-4 py-2 font-semibold text-ink-900" colSpan={5}>
              {s.closing > 0 ? 'Owed' : s.closing < 0 ? 'In credit' : 'All settled'}
            </td>
            <td className="tnum px-4 py-2 text-right text-[15px] font-bold">{formatMoney(Math.abs(s.closing), s.currency)}</td>
          </tr>
        </MoneyTable>
      </Card>
    </div>
  );
}
