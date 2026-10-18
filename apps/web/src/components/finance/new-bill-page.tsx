import Link from 'next/link';
import type { AuthUser, FinanceSettingsView, ServicePackageView, TaxRateView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { can } from '@/lib/permissions';
import { NoAccess } from '../no-access';
import { PageHeader } from '../ui';
import { InvoiceForm, QuoteForm } from '../billing/invoice-form';
import { pathsFor } from './workspace';

interface ClientDetail {
  id: string;
  fullName: string;
  email: string;
  cases: { id: string; reference: string; targetProgram: string | null; targetUniversity: string | null; targetCountry: string }[];
}

/** A new invoice or quote, with everything the form needs loaded once. */
export async function NewBillPage({ user, mode, clientId, caseId }: { user: AuthUser; mode: 'invoice' | 'quote'; clientId?: string; caseId?: string }) {
  if (!can(user, 'billing.invoice')) return <NoAccess title={mode === 'invoice' ? 'New invoice' : 'New quote'} permission="billing.invoice" />;
  const p = pathsFor(user);
  const [packages, taxRates, settings, client] = await Promise.all([
    apiFetch<ServicePackageView[]>('/billing/packages'),
    apiFetch<TaxRateView[]>('/billing/taxes'),
    apiFetch<FinanceSettingsView>('/finance/settings'),
    clientId ? apiFetch<ClientDetail>(`/clients/${clientId}`).catch(() => null) : Promise.resolve(null),
  ]);
  const clientsBase = p.clients;
  const back = client ? `${clientsBase}/${client.id}` : mode === 'invoice' ? p.invoices : p.quotes;
  return (
    <div>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
        <span aria-hidden>&larr;</span> {client ? `Back to ${client.fullName}` : mode === 'invoice' ? 'Back to invoices' : 'Back to quotes'}
      </Link>
      <PageHeader
        title={mode === 'invoice' ? 'New invoice' : 'New quote'}
        subtitle={
          mode === 'invoice'
            ? 'Consultancy fees, and fees paid on the student’s behalf (kept out of income). Tuition the student pays the university directly does not belong here.'
            : 'Priced like an invoice. The student accepts or declines it in their portal; an accepted quote becomes the invoice at these prices.'
        }
      />
      {(() => {
        const props = {
          packages,
          taxRates,
          baseCurrency: settings.baseCurrency,
          approvalPercent: settings.discountApprovalPercent,
          canApprove: can(user, 'billing.approve'),
          detailBase: mode === 'invoice' ? p.invoices : p.quotes,
          initialCaseId: caseId,
          initialClient: client
            ? {
                id: client.id,
                fullName: client.fullName,
                email: client.email,
                cases: client.cases.map((k) => ({ id: k.id, reference: k.reference, label: `${k.reference} · ${k.targetProgram ?? k.targetUniversity ?? k.targetCountry}` })),
              }
            : undefined,
        };
        return mode === 'invoice' ? <InvoiceForm {...props} /> : <QuoteForm {...props} />;
      })()}
    </div>
  );
}
