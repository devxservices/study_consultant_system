import Link from 'next/link';
import {
  PAYMENT_METHOD_LABEL,
  REFUND_STATUS_TONE,
  formatMoney,
  type AuthUser,
  type InvoiceSummaryView,
  type LedgerAccountView,
  type Paginated,
  type PaymentSubmissionView,
  type RefundRequestView,
} from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { formatDate, relativeDays } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, EmptyState, PageHeader, Pill, cx } from '../ui';
import { NoAccess } from '../no-access';
import { FinanceTabs, MoneyTable, pathsFor } from './workspace';
import { ReviewProof } from './review-proof';
import { DecideRefund } from './invoice-actions';

/** Students' proof of payment, waiting to be checked against the bank. */
export async function VerifyPage({ user, status = 'pending' }: { user: AuthUser; status?: string }) {
  if (!can(user, 'billing.verify')) return <NoAccess title="Payments to verify" permission="billing.verify" />;
  const p = pathsFor(user);
  const filter = ['pending', 'approved', 'rejected', 'all'].includes(status) ? status : 'pending';
  const [items, accounts] = await Promise.all([
    apiFetch<PaymentSubmissionView[]>(`/billing/submissions${qs({ status: filter })}`),
    apiFetch<LedgerAccountView[]>('/finance/account-options'),
  ]);
  const money = accounts.filter((a) => a.active && (a.subtype === 'cash' || a.subtype === 'bank' || a.subtype === 'clearing')).map((a) => ({ id: a.id, name: a.name }));
  return (
    <>
      <PageHeader title="Payments to verify" subtitle="Students who say they have paid, with their slip or screenshot. Check it against the bank before you record it." />
      <FinanceTabs user={user} active="verify" />
      <div className="mb-3 flex flex-wrap gap-1.5 text-[12.5px]">
        {[
          ['pending', 'Waiting'],
          ['approved', 'Recorded'],
          ['rejected', 'Sent back'],
          ['all', 'All'],
        ].map(([k, label]) => (
          <Link key={k} href={`${p.base}/verify${qs({ status: k })}`} className={cx('rounded-full px-2.5 py-1 ring-1', filter === k ? 'bg-ink-900 text-paper ring-ink-900' : 'text-ink-600 ring-line hover:bg-ink-50')}>
            {label}
          </Link>
        ))}
      </div>
      {items.length === 0 ? (
        <Card>
          <EmptyState title={filter === 'pending' ? 'Nothing waiting' : 'Nothing here'} description="When a student uploads proof of a transfer, it appears here for checking." />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <Card key={s.id} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="tnum text-[20px] font-semibold text-ink-950">{formatMoney(s.amount, s.currency)}</p>
                  <p className="text-[13.5px] text-ink-800">{s.clientName}</p>
                  <Link href={`${p.invoices}/${s.invoiceId}`} className="font-mono text-[12.5px] text-brand-700 hover:underline">
                    {s.invoiceNumber}
                  </Link>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-500">
                  {PAYMENT_METHOD_LABEL[s.method]} on {formatDate(s.paidOn)}
                  {s.reference ? ` · reference ${s.reference}` : ''} · sent {relativeDays(s.createdAt)}
                </p>
                {s.note && <p className="mt-1 text-[13px] text-ink-700">“{s.note}”</p>}
                {s.documentId && (
                  <a href={`/api/documents/${s.documentId}/file`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline">
                    Open {s.fileName ?? 'the slip'} ↗
                  </a>
                )}
              </div>
              <div>
                {s.status === 'pending' ? (
                  <ReviewProof id={s.id} amount={s.amount} currency={s.currency} paidOn={s.paidOn} accounts={money} />
                ) : (
                  <div className="text-[12.5px] text-ink-600">
                    <Pill tone={s.status === 'approved' ? 'ok' : 'bad'}>{s.status === 'approved' ? `Receipt ${s.receiptNumber}` : 'Sent back'}</Pill>
                    <p className="mt-1">
                      by {s.reviewedByName ?? 'someone'}
                      {s.reviewedAt ? `, ${formatDate(s.reviewedAt)}` : ''}
                    </p>
                    {s.reviewNote && <p className="mt-1 text-ink-700">{s.reviewNote}</p>}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/** Discounts over the limit and refunds, waiting for a second pair of eyes. */
export async function ApprovalsPage({ user }: { user: AuthUser }) {
  const approve = can(user, 'billing.approve');
  if (!approve && !can(user, 'billing.refund')) return <NoAccess title="Approvals" permission="billing.approve" />;
  const p = pathsFor(user);
  const [invoices, refunds] = await Promise.all([
    apiFetch<Paginated<InvoiceSummaryView>>('/billing/invoices?status=pending&pageSize=100'),
    apiFetch<RefundRequestView[]>('/billing/refund-requests'),
  ]);
  const waiting = refunds.filter((r) => r.status === 'pending');
  const decided = refunds.filter((r) => r.status !== 'pending').slice(0, 20);
  return (
    <>
      <PageHeader title="Approvals" subtitle="Nobody approves their own discount or refund." />
      <FinanceTabs user={user} active="approvals" />

      <h2 className="mb-2 text-[15px] font-medium text-ink-950">Discounted invoices</h2>
      <Card className="mb-6 overflow-hidden">
        {invoices.items.length === 0 ? (
          <p className="px-4 py-5 text-[13px] text-ink-400 sm:px-5">None waiting.</p>
        ) : (
          <MoneyTable head={['Invoice', 'Student', 'Issued', { label: 'Total', right: true }]}>
            {invoices.items.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="px-4 py-2.5">
                  <Link href={`${p.invoices}/${i.id}`} className="font-mono text-[13px] font-medium text-brand-700 hover:underline">
                    {i.number}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-ink-800">{i.clientName}</td>
                <td className="tnum px-4 py-2.5 text-ink-500">{formatDate(i.issueDate)}</td>
                <td className="tnum px-4 py-2.5 text-right font-semibold">{formatMoney(i.total, i.currency)}</td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>

      <h2 className="mb-2 text-[15px] font-medium text-ink-950">Refunds</h2>
      {waiting.length === 0 ? (
        <Card className="mb-6">
          <p className="px-4 py-5 text-[13px] text-ink-400 sm:px-5">None waiting.</p>
        </Card>
      ) : (
        <div className="mb-6 space-y-3">
          {waiting.map((r) => (
            <Card key={r.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5">
              <div className="min-w-0">
                <p className="tnum text-[18px] font-semibold text-ink-950">{formatMoney(r.amount, r.currency)}</p>
                <p className="text-[13px] text-ink-700">
                  {r.clientName} ·{' '}
                  <Link href={`${p.invoices}/${r.invoiceId}`} className="font-mono text-brand-700 hover:underline">
                    {r.invoiceNumber}
                  </Link>{' '}
                  · {PAYMENT_METHOD_LABEL[r.method]}
                </p>
                <p className="mt-1 text-[13px] text-ink-600">
                  “{r.reason}” - asked by {r.requestedByName ?? 'someone'} {relativeDays(r.createdAt)}
                </p>
              </div>
              <div>{approve && r.requestedById !== user.id ? <DecideRefund id={r.id} /> : <p className="text-[12.5px] text-ink-400">Someone else approves this.</p>}</div>
            </Card>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Decided recently</h2>
          <Card className="overflow-hidden">
            <MoneyTable head={['Student', 'Invoice', 'Status', 'Decided by', { label: 'Amount', right: true }]}>
              {decided.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-2.5 text-ink-800">{r.clientName}</td>
                  <td className="px-4 py-2.5 font-mono text-[12.5px]">{r.invoiceNumber}</td>
                  <td className="px-4 py-2.5">
                    <Pill tone={REFUND_STATUS_TONE[r.status]}>{r.status}</Pill>
                  </td>
                  <td className="px-4 py-2.5 text-ink-500">{r.decidedByName ?? '-'}</td>
                  <td className="tnum px-4 py-2.5 text-right">{formatMoney(r.amount, r.currency)}</td>
                </tr>
              ))}
            </MoneyTable>
          </Card>
        </>
      )}
    </>
  );
}
