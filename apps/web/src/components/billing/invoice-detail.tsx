import { PageStamp } from '../page-stamp';
import Link from 'next/link';
import {
  FEE_CATEGORY_LABEL,
  INSTALLMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  REFUND_STATUS_TONE,
  formatMoney,
  type AuthUser,
  type InvoiceView,
  type LedgerAccountView,
} from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { getSite, siteBranding, siteName } from '@/lib/site';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { BrandMark } from '../brand-mark';
import { Card, Pill, cx } from '../ui';
import { ActionButton, ReasonAction } from '../forms';
import { PaymentForm, PrintButton } from './payment-form';
import {
  ApprovalActions,
  CreditNoteForm,
  DecideRefund,
  InstallmentsEditor,
  PayOnline,
  ProofForm,
  RefundRequestForm,
} from '../finance/invoice-actions';

interface PaymentOptions {
  online: boolean;
  bankDetails: string | null;
  directRefunds: boolean;
}

/**
 * One invoice: the document itself on the left, exactly as it prints, and the
 * money on the right - what is owed and when, the ledger of everything
 * received or refunded, credit notes, proofs waiting to be checked, and the
 * actions this person is allowed.
 */
export async function InvoiceDetail({
  invoice,
  user,
  backHref,
  backLabel,
  receiptBase,
  clientHref,
  statementHref,
  flash,
}: {
  invoice: InvoiceView;
  user: AuthUser;
  backHref: string;
  backLabel: string;
  /** Where a receipt opens, e.g. /overview/finance/receipts */
  receiptBase: string;
  clientHref?: string;
  statementHref?: string;
  /** Back from an online payment: ?paid= or ?cancelled= */
  flash?: 'paid' | 'cancelled' | null;
}) {
  const staff = user.role === 'manager' || user.role === 'consultant';
  const [site, options, accounts] = await Promise.all([
    getSite(),
    apiFetch<PaymentOptions>('/billing/payment-options').catch(() => ({ online: false, bankDetails: null, directRefunds: true })),
    staff ? apiFetch<LedgerAccountView[]>('/finance/account-options').catch(() => [] as LedgerAccountView[]) : Promise.resolve([] as LedgerAccountView[]),
  ]);
  const branding = siteBranding(site);
  const name = siteName(site);
  const money = accounts.filter((a) => a.active && (a.subtype === 'cash' || a.subtype === 'bank' || a.subtype === 'clearing')).map((a) => ({ id: a.id, name: a.name }));
  const isVoid = invoice.status === 'void';
  const pending = invoice.status === 'pending_approval';
  const approver = staff && can(user, 'billing.approve');
  const owed = Math.max(0, invoice.balance);
  const anyDiscount = invoice.items.some((i) => i.discount > 0);
  const anyTax = invoice.items.some((i) => i.tax > 0);
  const pendingProofs = invoice.submissions.filter((s) => s.status === 'pending');
  const pendingRefunds = invoice.refundRequests.filter((r) => r.status === 'pending').reduce((n, r) => n + r.amount, 0);

  return (
    <div>
      <PageStamp />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
          <span aria-hidden>&larr;</span> {backLabel}
        </Link>
        <div className="flex flex-wrap gap-2">
          {statementHref && (
            <Link href={statementHref} className="inline-flex h-9.5 items-center rounded-lg px-3 text-[13.5px] font-medium text-ink-700 hover:bg-ink-50">
              Statement
            </Link>
          )}
          <a href={`/api/billing/invoices/${invoice.id}/pdf?download=1`} className="inline-flex h-9.5 items-center rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] font-medium text-ink-800 hover:bg-ink-50">
            Download PDF
          </a>
          <PrintButton label="Print" />
        </div>
      </div>

      {flash === 'paid' && (
        <p className="mb-4 rounded-lg bg-ok-50 px-4 py-3 text-[13.5px] text-ok-700 print:hidden">
          Thank you. As soon as the payment provider confirms it, your receipt appears below and is emailed to you.
        </p>
      )}
      {flash === 'cancelled' && <p className="mb-4 rounded-lg bg-ink-50 px-4 py-3 text-[13.5px] text-ink-600 print:hidden">The payment was cancelled. Nothing was taken.</p>}

      {pending && (
        <Card className="mb-5 border-l-4 border-warn-500 p-4 print:hidden">
          <p className="text-[14px] font-medium text-ink-950">Waiting for approval</p>
          <p className="mt-0.5 text-[13px] text-ink-600">
            The discount ({formatMoney(invoice.discount, invoice.currency)} on {formatMoney(invoice.subtotal, invoice.currency)}) is over the consultancy’s limit. The student does not see this invoice
            until someone with approval rights - not {invoice.createdByName ?? 'whoever wrote it'} - approves it.
            {invoice.discountReason ? ` Reason given: “${invoice.discountReason}”.` : ''}
          </p>
          {approver && invoice.createdById !== user.id && (
            <div className="mt-3">
              <ApprovalActions invoiceId={invoice.id} />
            </div>
          )}
        </Card>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------------- The document ---------------- */}
        <Card className="relative overflow-hidden p-6 sm:p-10 print:shadow-none">
          {isVoid && (
            <span className="pointer-events-none absolute right-8 top-24 rotate-[-12deg] rounded-lg border-4 border-bad-500/60 px-4 py-1 text-[32px] font-bold tracking-widest text-bad-500/60">VOID</span>
          )}
          {!isVoid && invoice.paymentStatus === 'paid' && (
            <span className="pointer-events-none absolute right-8 top-24 rotate-[-12deg] rounded-lg border-4 border-ok-500/60 px-4 py-1 text-[32px] font-bold tracking-widest text-ok-500/60">PAID</span>
          )}

          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
            <div className="flex items-center gap-3">
              <BrandMark name={name} branding={branding} size={48} />
              <div>
                <p className="text-[17px] font-semibold text-ink-950">{name}</p>
                {branding?.contactEmail && <p className="text-[12.5px] text-ink-500">{branding.contactEmail}</p>}
                {branding?.contactPhone && <p className="text-[12.5px] text-ink-500">{branding.contactPhone}</p>}
              </div>
            </div>
            <div className="text-right">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">{pending ? 'Draft invoice' : 'Invoice'}</p>
              <p className="font-mono text-[20px] font-semibold text-ink-950">{invoice.number}</p>
              <p className="mt-1 text-[12.5px] text-ink-500">Issued {formatDate(invoice.issueDate)}</p>
              <p className={cx('text-[12.5px]', invoice.overdue ? 'font-semibold text-bad-700' : 'text-ink-500')}>{invoice.nextDue && invoice.nextDue.dueDate !== invoice.dueDate ? <>Next installment due {formatDate(invoice.nextDue.dueDate)} · last due {formatDate(invoice.dueDate)}</> : <>Due {formatDate(invoice.dueDate)}</>}</p>
              {invoice.quoteNumber && <p className="text-[12px] text-ink-400">From quote {invoice.quoteNumber}</p>}
              {invoice.parentInvoice && <p className="text-[12px] text-ink-400">Late fee on {invoice.parentInvoice.number}</p>}
            </div>
          </header>

          <section className="grid gap-6 py-6 sm:grid-cols-2">
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Bill to</p>
              {clientHref && staff ? (
                <Link href={clientHref} className="mt-1 block text-[15px] font-semibold text-ink-950 hover:text-brand-700 print:text-ink-950">
                  {invoice.clientName}
                </Link>
              ) : (
                <p className="mt-1 text-[15px] font-semibold text-ink-950">{invoice.clientName}</p>
              )}
              <p className="text-[13px] text-ink-500">{invoice.clientEmail}</p>
              <p className="text-[13px] text-ink-500">{invoice.clientPhone}</p>
            </div>
            {invoice.caseReference && (
              <div className="sm:text-right">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Application</p>
                <p className="mt-1 font-mono text-[13.5px] text-ink-800">{invoice.caseReference}</p>
              </div>
            )}
          </section>

          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-y border-line text-left text-[12.5px] font-medium text-ink-500">
                  <th className="py-2.5 font-semibold">Description</th>
                  <th className="py-2.5 text-right font-semibold">Qty</th>
                  <th className="py-2.5 text-right font-semibold">Unit price</th>
                  {anyDiscount && <th className="py-2.5 text-right font-semibold">Discount</th>}
                  {anyTax && <th className="py-2.5 text-right font-semibold">Tax</th>}
                  <th className="py-2.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id} className="border-b border-line">
                    <td className="py-3 text-ink-900">
                      {item.description}
                      {staff && <span className="block text-[11.5px] text-ink-400">{FEE_CATEGORY_LABEL[item.category]}</span>}
                    </td>
                    <td className="tnum py-3 text-right text-ink-600">{item.quantity}</td>
                    <td className="tnum py-3 text-right text-ink-600">{formatMoney(item.unitAmount, invoice.currency)}</td>
                    {anyDiscount && <td className="tnum py-3 text-right text-ink-600">{item.discount ? `−${formatMoney(item.discount, invoice.currency)}` : ''}</td>}
                    {anyTax && (
                      <td className="tnum py-3 text-right text-ink-600">
                        {item.tax ? formatMoney(item.tax, invoice.currency) : ''}
                        {item.taxRateName && <span className="block text-[11px] text-ink-400">{item.taxRateName}{item.taxInclusive ? ', included' : ''}</span>}
                      </td>
                    )}
                    <td className="tnum py-3 text-right font-medium text-ink-900">{formatMoney(item.total, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="ml-auto mt-4 w-full max-w-xs space-y-1.5 text-[13.5px]">
            {(invoice.discount > 0 || invoice.tax > 0) && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Subtotal</dt>
                <dd className="tnum text-ink-700">{formatMoney(invoice.subtotal, invoice.currency)}</dd>
              </div>
            )}
            {invoice.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Discount{invoice.promoCode ? ` (${invoice.promoCode})` : ''}</dt>
                <dd className="tnum text-ink-700">−{formatMoney(invoice.discount, invoice.currency)}</dd>
              </div>
            )}
            {invoice.tax > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Tax</dt>
                <dd className="tnum text-ink-700">{formatMoney(invoice.tax, invoice.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-500">Total</dt>
              <dd className="tnum font-semibold text-ink-950">{formatMoney(invoice.total, invoice.currency)}</dd>
            </div>
            {invoice.credited > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Credit notes</dt>
                <dd className="tnum text-ink-700">−{formatMoney(invoice.credited, invoice.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-500">Paid</dt>
              <dd className="tnum text-ink-700">{formatMoney(invoice.paid, invoice.currency)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2">
              <dt className="font-semibold text-ink-900">Balance due</dt>
              <dd className="tnum text-[17px] font-bold text-ink-950">{isVoid ? '—' : formatMoney(owed, invoice.currency)}</dd>
            </div>
          </dl>

          {invoice.installments.length > 0 && (
            <section className="mt-8">
              <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Payment schedule</p>
              <table className="w-full text-[13px]">
                <tbody>
                  {invoice.installments.map((i) => (
                    <tr key={i.id} className="border-b border-line last:border-0">
                      <td className="py-2 text-ink-800">
                        {i.seq}. {i.label ?? 'Installment'}
                      </td>
                      <td className={cx('tnum py-2', i.status === 'overdue' ? 'font-semibold text-bad-700' : 'text-ink-600')}>{formatDate(i.dueDate)}</td>
                      <td className="tnum py-2 text-right text-ink-900">{formatMoney(i.amount, invoice.currency)}</td>
                      <td className="py-2 pl-3 text-right">
                        <Pill tone={i.status === 'paid' ? 'ok' : i.status === 'overdue' ? 'bad' : i.status === 'partial' ? 'info' : 'neutral'}>
                          {i.status === 'partial' ? `${formatMoney(i.paid, invoice.currency)} paid` : INSTALLMENT_STATUS_LABEL[i.status]}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {options.bankDetails && !isVoid && (
            <section className="mt-8 rounded-lg bg-ink-50 p-4">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">How to pay</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-700">{options.bankDetails}</p>
            </section>
          )}
          {invoice.notes && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-ink-50 p-4 text-[13px] leading-relaxed text-ink-600">{invoice.notes}</p>}
          {isVoid && invoice.voidReason && (
            <p className="mt-4 text-[12.5px] text-bad-700">
              Voided{invoice.voidedAt ? ` on ${formatDate(invoice.voidedAt)}` : ''}: {invoice.voidReason}
            </p>
          )}
          {invoice.approvedByName && <p className="mt-4 text-[11.5px] text-ink-400">Discount approved by {invoice.approvedByName}.</p>}
        </Card>

        {/* ---------------- The money ---------------- */}
        <div className="space-y-5 print:hidden">
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-ink-500">Balance</p>
              <Pill tone={invoice.overdue ? 'bad' : PAYMENT_STATUS_TONE[invoice.paymentStatus]} dot>
                {invoice.overdue ? 'Overdue' : PAYMENT_STATUS_LABEL[invoice.paymentStatus]}
              </Pill>
            </div>
            <p className="tnum mt-1 text-[28px] font-semibold text-ink-950">{isVoid ? '—' : formatMoney(owed, invoice.currency)}</p>
            <p className="text-[12.5px] text-ink-400">
              {formatMoney(invoice.paid, invoice.currency)} of {formatMoney(invoice.total - invoice.credited, invoice.currency)} paid
            </p>
            {invoice.nextDue && (
              <p className={cx('mt-1 text-[12.5px]', invoice.overdue ? 'font-medium text-bad-700' : 'text-ink-600')}>
                Next: {formatMoney(invoice.nextDue.amount, invoice.currency)} {invoice.overdue ? 'was due' : 'due'} {formatDate(invoice.nextDue.dueDate)}
              </p>
            )}
            {invoice.balance < 0 && !isVoid && <p className="mt-2 text-[12.5px] text-bad-700">Overpaid by {formatMoney(-invoice.balance, invoice.currency)} - due back to the student.</p>}
            {staff && invoice.status === 'issued' && (
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton url={`/api/billing/invoices/${invoice.id}/email`} variant="secondary">
                  Email to student
                </ActionButton>
              </div>
            )}
          </Card>

          {/* The student pays */}
          {user.role === 'client' && invoice.status === 'issued' && owed > 0 && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-[15px] font-semibold text-ink-950">Pay</h2>
              {options.online && <PayOnline invoiceId={invoice.id} currency={invoice.currency} balance={owed} nextDue={invoice.nextDue} />}
              <details className={cx(options.online && 'mt-4 border-t border-line pt-3')} open={!options.online}>
                <summary className="cursor-pointer text-[13.5px] font-medium text-ink-800">Paid by transfer or in person? Upload the proof</summary>
                <div className="mt-3">
                  <ProofForm invoiceId={invoice.id} currency={invoice.currency} suggested={invoice.nextDue?.amount ?? owed} />
                </div>
              </details>
            </Card>
          )}

          {/* Proofs of payment */}
          {invoice.submissions.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 pb-2 pt-4 sm:px-5">
                <h2 className="text-[15px] font-semibold text-ink-950">Proof of payment</h2>
                {staff && pendingProofs.length > 0 && can(user, 'billing.verify') && (
                  <p className="text-[12.5px] text-ink-500">
                    Check {pendingProofs.length === 1 ? 'it' : 'them'} under{' '}
                    <Link href={user.role === 'manager' ? '/overview/finance/verify' : '/desk/finance/verify'} className="text-brand-700 hover:underline">
                      To verify
                    </Link>
                    .
                  </p>
                )}
              </div>
              <ul className="divide-y divide-line">
                {invoice.submissions.map((s) => (
                  <li key={s.id} className="px-4 py-3 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 text-[12.5px] text-ink-500">
                        <p className="tnum text-[13.5px] font-medium text-ink-900">{formatMoney(s.amount, s.currency)}</p>
                        {PAYMENT_METHOD_LABEL[s.method]} · {formatDate(s.paidOn)}
                        {s.reference ? ` · ${s.reference}` : ''}
                        {s.reviewNote && <p className="mt-1 text-ink-700">{s.reviewNote}</p>}
                      </div>
                      <Pill tone={s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'bad' : 'warn'}>
                        {s.status === 'approved' ? `Receipt ${s.receiptNumber}` : s.status === 'rejected' ? 'Not confirmed' : 'Being checked'}
                      </Pill>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {staff && can(user, 'billing.payment') && invoice.status === 'issued' && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-[15px] font-semibold text-ink-950">Record money received</h2>
              <PaymentForm invoiceId={invoice.id} currency={invoice.currency} balance={owed} paid={invoice.paid} canRefund={user.role === 'manager' && options.directRefunds} accounts={money} />
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="px-4 pb-2 pt-4 sm:px-5">
              <h2 className="text-[15px] font-semibold text-ink-950">Ledger</h2>
              <p className="text-[12.5px] text-ink-400">Nothing here is ever edited or deleted - a mistake is voided, with the reason kept.</p>
            </div>
            {invoice.payments.length === 0 ? (
              <p className="px-4 pb-5 text-[13px] text-ink-400 sm:px-5">Nothing received yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {invoice.payments.map((p) => (
                  <li key={p.id} className={cx('px-4 py-3 sm:px-5', p.voided && 'bg-ink-50/70')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`${receiptBase}/${p.id}`} className="font-mono text-[12.5px] font-medium text-ink-900 hover:text-brand-700 hover:underline">
                          {p.number}
                        </Link>
                        <p className="text-[12px] text-ink-400">
                          {formatDate(p.receivedOn)} · {PAYMENT_METHOD_LABEL[p.method]}
                          {p.reference ? ` · ${p.reference}` : ''}
                        </p>
                        {staff && (p.recordedByName || p.accountName) && (
                          <p className="text-[12px] text-ink-400">
                            {p.accountName ? `${p.kind === 'refund' ? 'from' : 'into'} ${p.accountName}` : ''}
                            {p.recordedByName ? ` · by ${p.recordedByName}` : ''}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cx('tnum text-[14px] font-semibold', p.voided ? 'text-ink-400 line-through' : p.kind === 'refund' ? 'text-bad-700' : 'text-ok-700')}>
                          {p.kind === 'refund' ? '−' : '+'}
                          {formatMoney(p.amount, p.currency)}
                        </p>
                        {p.kind === 'refund' && <Pill tone="bad">Refund</Pill>}
                        {p.voided && <Pill tone="neutral">Void</Pill>}
                      </div>
                    </div>
                    {p.voided && p.voidReason && <p className="mt-1.5 text-[12px] text-ink-500">Voided by {p.voidedByName ?? 'a manager'}: {p.voidReason}</p>}
                    {approver && !p.voided && (
                      <div className="mt-2">
                        <ReasonAction
                          label="Void entry"
                          confirmLabel="Void it"
                          url={`/api/billing/payments/${p.id}/void`}
                          explanation="The entry stays on the ledger marked void, and the books get a reversing entry. Say why - the reason is kept with it."
                          placeholder="e.g. Recorded twice by mistake"
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {staff && can(user, 'billing.invoice') && invoice.status !== 'void' && (
            <Card className="p-4 sm:p-5">
              <h2 className="text-[15px] font-semibold text-ink-950">Payment schedule</h2>
              <p className="mb-3 mt-0.5 text-[12.5px] text-ink-400">Split what is owed into dated parts, each reminded and charged late fees on its own.</p>
              <InstallmentsEditor invoiceId={invoice.id} total={invoice.total} currency={invoice.currency} installments={invoice.installments} issueDate={invoice.issueDate} />
            </Card>
          )}

          {(invoice.creditNotes.length > 0 || (approver && invoice.status === 'issued')) && staff && (
            <Card className="p-4 sm:p-5">
              <h2 className="text-[15px] font-semibold text-ink-950">Credit notes</h2>
              <p className="mb-3 mt-0.5 text-[12.5px] text-ink-400">Give part of the invoice back - a discount agreed later, a service not delivered. Money already paid beyond it is then refunded.</p>
              {invoice.creditNotes.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {invoice.creditNotes.map((c) => (
                    <li key={c.id} className={cx('rounded-lg border border-line px-3 py-2 text-[12.5px]', c.voided && 'opacity-60')}>
                      <div className="flex justify-between gap-2">
                        <span className="font-mono font-medium text-ink-900">{c.number}</span>
                        <span className={cx('tnum font-semibold', c.voided ? 'text-ink-400 line-through' : 'text-ink-900')}>−{formatMoney(c.amount, c.currency)}</span>
                      </div>
                      <p className="text-ink-500">
                        {formatDate(c.issuedOn)} · {c.reason}
                      </p>
                      {c.voided && <p className="text-ink-500">Voided: {c.voidReason}</p>}
                      {approver && !c.voided && (
                        <div className="mt-1">
                          <ReasonAction label="Void" confirmLabel="Void credit note" url={`/api/billing/credit-notes/${c.id}/void`} explanation="The amount becomes owed again." placeholder="e.g. Issued by mistake" />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {approver && invoice.status === 'issued' && <CreditNoteForm invoiceId={invoice.id} currency={invoice.currency} room={invoice.total - invoice.credited} />}
            </Card>
          )}

          {staff && (invoice.refundRequests.length > 0 || (can(user, 'billing.refund') && invoice.paid > 0)) && (
            <Card className="p-4 sm:p-5">
              <h2 className="text-[15px] font-semibold text-ink-950">Refunds</h2>
              <p className="mb-3 mt-0.5 text-[12.5px] text-ink-400">Asked for by one person, approved by another.</p>
              {invoice.refundRequests.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {invoice.refundRequests.map((r) => (
                    <li key={r.id} className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="tnum font-semibold text-ink-900">{formatMoney(r.amount, r.currency)}</span>
                        <Pill tone={REFUND_STATUS_TONE[r.status]}>{r.status}</Pill>
                      </div>
                      <p className="text-ink-500">
                        {r.reason} · asked by {r.requestedByName ?? 'someone'}
                      </p>
                      {r.decisionNote && <p className="text-ink-600">{r.decisionNote}</p>}
                      {r.status === 'pending' && approver && r.requestedById !== user.id && (
                        <div className="mt-2">
                          <DecideRefund id={r.id} />
                        </div>
                      )}
                      {r.status === 'pending' && (r.requestedById === user.id || user.role === 'manager') && (
                        <div className="mt-1">
                          <ActionButton url={`/api/billing/refund-requests/${r.id}/cancel`} variant="ghost">
                            Withdraw
                          </ActionButton>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {can(user, 'billing.refund') && invoice.status === 'issued' && <RefundRequestForm invoiceId={invoice.id} currency={invoice.currency} max={invoice.paid - pendingRefunds} accounts={money} />}
            </Card>
          )}

          {approver && invoice.status === 'issued' && (
            <Card className="p-4 sm:p-5">
              <h2 className="text-[15px] font-semibold text-ink-950">Void this invoice</h2>
              <p className="mb-3 mt-0.5 text-[12.5px] text-ink-400">For an invoice issued by mistake. Void payments and credit notes on it first; it stays on record marked void, and the books are reversed.</p>
              <ReasonAction
                label="Void invoice"
                confirmLabel="Void invoice"
                variant="secondary"
                url={`/api/billing/invoices/${invoice.id}/void`}
                explanation="This cannot be undone. Issue a new invoice if the charges are still owed."
                placeholder="e.g. Issued to the wrong client"
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
