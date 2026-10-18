import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  FEE_CATEGORY_LABEL,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  formatMoney,
  type AuthUser,
  type Paginated,
  type QuoteView,
} from '@crm/shared';
import { ApiError, apiFetch, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { Card, EmptyState, LinkButton, PageHeader, Pill, cx } from '../ui';
import { ActionButton } from '../forms';
import { IconPlus } from '../icons';
import { Pagination } from '../client-table';
import { FinanceTabs, MoneyTable, hasWorkspace, pathsFor } from './workspace';
import { ConvertQuote, QuoteDecision } from './invoice-actions';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'sent', label: 'Waiting for the student' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'converted', label: 'Invoiced' },
  { key: 'declined', label: 'Declined' },
  { key: 'expired', label: 'Expired' },
] as const;

export async function QuotesListPage({ user, query }: { user: AuthUser; query: { status?: string; page?: string } }) {
  const p = pathsFor(user);
  const status = FILTERS.some((f) => f.key === query.status) ? query.status! : 'all';
  const page = Math.max(1, Number(query.page) || 1);
  const quotes = await apiFetch<Paginated<QuoteView>>(`/billing/quotes${qs({ status, page })}`);
  const href = (x: Record<string, string | number | undefined>) => `${p.quotes}${qs({ status, ...x })}`;
  return (
    <>
      <PageHeader
        title="Quotes"
        subtitle="Quotes and proforma invoices. An accepted quote becomes the invoice at the prices quoted."
        actions={
          can(user, 'billing.invoice') ? (
            <LinkButton href={`${p.quotes}/new`}>
              <IconPlus size={16} />
              New quote
            </LinkButton>
          ) : undefined
        }
      />
      {(user.role === 'manager' || hasWorkspace(user)) && <FinanceTabs user={user} active="quotes" />}
      <div className="mb-3 flex flex-wrap gap-1.5 text-[12.5px]">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href({ status: f.key, page: undefined })}
            className={cx('rounded-full px-2.5 py-1 ring-1', status === f.key ? 'bg-ink-900 text-paper ring-ink-900' : 'text-ink-600 ring-line hover:bg-ink-50')}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <Card className="overflow-hidden">
        {quotes.items.length === 0 ? (
          <EmptyState title="No quotes here" description="Send a student a quote before they commit - they accept it in their portal." />
        ) : (
          <MoneyTable head={['Quote', 'Student', 'Date', 'Valid until', 'Status', { label: 'Total', right: true }]}>
            {quotes.items.map((q) => (
              <tr key={q.id} className="border-t border-line hover:bg-ink-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`${p.quotes}/${q.id}`} className="font-mono text-[13px] font-medium text-ink-950 hover:text-brand-700 hover:underline">
                    {q.number}
                  </Link>
                  {q.proforma && <span className="ml-1.5 text-[11.5px] text-ink-400">proforma</span>}
                </td>
                <td className="px-4 py-2.5 text-ink-800">{q.clientName}</td>
                <td className="tnum px-4 py-2.5 text-ink-500">{formatDate(q.issueDate)}</td>
                <td className="tnum px-4 py-2.5 text-ink-500">{formatDate(q.validUntil)}</td>
                <td className="px-4 py-2.5">
                  <Pill tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Pill>
                </td>
                <td className="tnum px-4 py-2.5 text-right font-semibold text-ink-950">{formatMoney(q.total, q.currency)}</td>
              </tr>
            ))}
          </MoneyTable>
        )}
      </Card>
      <Pagination data={quotes} buildHref={(n) => href({ page: n })} />
    </>
  );
}

/** One quote. Staff send and invoice it; the student accepts or declines it. */
export async function QuoteDetailPage({ user, id, base }: { user: AuthUser; id: string; base?: string }) {
  let q: QuoteView;
  try {
    q = await apiFetch<QuoteView>(`/billing/quotes/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const staff = user.role !== 'client';
  const p = staff ? pathsFor(user) : null;
  const listHref = base ?? p!.quotes;
  const open = q.status === 'sent';
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link href={listHref} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
          <span aria-hidden>&larr;</span> {staff ? 'Back to quotes' : 'Back to payments'}
        </Link>
        <a href={`/api/billing/quotes/${q.id}/pdf`} className="inline-flex h-9.5 items-center rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] font-medium text-ink-800 hover:bg-ink-50">
          Download PDF
        </a>
      </div>
      <PageHeader
        title={`${q.proforma ? 'Proforma invoice' : 'Quote'} ${q.number}`}
        subtitle={`${q.clientName}${q.caseReference ? ` · ${q.caseReference}` : ''} · valid until ${formatDate(q.validUntil)}`}
        actions={<Pill tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Pill>}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <MoneyTable head={['Description', { label: 'Qty', right: true }, { label: 'Unit price', right: true }, { label: 'Discount', right: true }, { label: 'Tax', right: true }, { label: 'Amount', right: true }]}>
            {q.items.map((i, n) => (
              <tr key={n} className="border-t border-line">
                <td className="px-4 py-2.5 text-ink-900">
                  {i.description}
                  {staff && <span className="block text-[11.5px] text-ink-400">{FEE_CATEGORY_LABEL[i.category]}</span>}
                </td>
                <td className="tnum px-4 py-2.5 text-right text-ink-600">{i.quantity}</td>
                <td className="tnum px-4 py-2.5 text-right text-ink-600">{formatMoney(i.unitAmount, q.currency)}</td>
                <td className="tnum px-4 py-2.5 text-right text-ink-600">{i.discount ? `−${formatMoney(i.discount, q.currency)}` : ''}</td>
                <td className="tnum px-4 py-2.5 text-right text-ink-600">{i.tax ? formatMoney(i.tax, q.currency) : ''}</td>
                <td className="tnum px-4 py-2.5 text-right font-medium text-ink-900">{formatMoney(i.total, q.currency)}</td>
              </tr>
            ))}
          </MoneyTable>
          <dl className="ml-auto w-full max-w-xs space-y-1.5 px-4 py-4 text-[13.5px] sm:px-5">
            <div className="flex justify-between">
              <dt className="text-ink-500">Subtotal</dt>
              <dd className="tnum">{formatMoney(q.subtotal, q.currency)}</dd>
            </div>
            {q.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Discount{q.promoCode ? ` (${q.promoCode})` : ''}</dt>
                <dd className="tnum">−{formatMoney(q.discount, q.currency)}</dd>
              </div>
            )}
            {q.tax > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Tax</dt>
                <dd className="tnum">{formatMoney(q.tax, q.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-line pt-2">
              <dt className="font-semibold text-ink-900">Total</dt>
              <dd className="tnum text-[17px] font-bold text-ink-950">{formatMoney(q.total, q.currency)}</dd>
            </div>
          </dl>
          {q.notes && <p className="mx-4 mb-4 whitespace-pre-wrap rounded-lg bg-ink-50 p-4 text-[13px] text-ink-600 sm:mx-5">{q.notes}</p>}
        </Card>
        <div className="space-y-5">
          {q.decisionNote && (
            <Card className="p-4">
              <p className="text-[12.5px] text-ink-500">
                {q.status === 'declined' ? 'Declined' : 'Accepted'}
                {q.decidedAt ? ` on ${formatDate(q.decidedAt)}` : ''}
              </p>
              <p className="mt-1 text-[13.5px] text-ink-800">{q.decisionNote}</p>
            </Card>
          )}
          {open && (!staff || can(user, 'billing.invoice')) && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-1 text-[15px] font-semibold text-ink-950">{staff ? 'Record the student’s answer' : 'Your answer'}</h2>
              <p className="mb-3 text-[12.5px] text-ink-500">{staff ? 'If they replied by phone or in person.' : 'Accepting tells your consultant to go ahead and invoice you.'}</p>
              <QuoteDecision quoteId={q.id} />
            </Card>
          )}
          {staff && q.status === 'draft' && can(user, 'billing.invoice') && (
            <Card className="p-4 sm:p-5">
              <p className="mb-3 text-[13px] text-ink-600">Only you can see this draft.</p>
              <ActionButton url={`/api/billing/quotes/${q.id}/send`} variant="primary" size="md">
                Send to the student
              </ActionButton>
            </Card>
          )}
          {staff && (q.status === 'accepted' || q.status === 'sent') && can(user, 'billing.invoice') && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-[15px] font-semibold text-ink-950">Invoice it</h2>
              <ConvertQuote quoteId={q.id} detailBase={p!.invoices} />
            </Card>
          )}
          {q.invoiceId && (
            <Card className="p-4">
              <p className="text-[13px] text-ink-600">
                Invoiced as{' '}
                <Link href={`${staff ? p!.invoices : '/portal/payments/invoices'}/${q.invoiceId}`} className="font-mono font-medium text-brand-700 hover:underline">
                  {q.invoiceNumber}
                </Link>
                .
              </p>
            </Card>
          )}
          {staff && <p className="text-[12px] text-ink-400">Written by {q.createdByName ?? 'someone'} on {formatDate(q.createdAt)}.</p>}
        </div>
      </div>
    </div>
  );
}
