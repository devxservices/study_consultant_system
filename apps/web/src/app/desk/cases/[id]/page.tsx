import { notFound } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import type { DocumentView, InvoiceSummaryView, MessageView, Paginated, TaskView } from '@crm/shared';
import { enabledModules } from '@/lib/entitlements';
import { CaseView, type CaseDetail } from '@/components/case-view';
import { CaseCommissionCard } from '@/components/commissions/case-card';

export default async function DeskCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  const { id } = await params;

  let detail: CaseDetail;
  try {
    detail = await apiFetch<CaseDetail>(`/cases/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }

  // Each part of the page is only asked for when this consultant may see it,
  // so a missing permission is a note on the page, never a broken one.
  const modules = await enabledModules();
  const seeDocuments = can(user, 'document.view');
  const seeChat = can(user, 'chat.view');
  const seeMoney = modules.has('billing') && can(user, 'billing.view');
  const [documents, messages, tasks, invoices] = await Promise.all([
    seeDocuments
      ? apiFetch<Paginated<DocumentView>>(`/documents?caseId=${id}&pageSize=100&sort=newest`).then((r) => r.items)
      : Promise.resolve([] as DocumentView[]),
    seeChat ? apiFetch<MessageView[]>(`/messages?caseId=${id}&limit=50`) : Promise.resolve([] as MessageView[]),
    modules.has('tasks')
      ? apiFetch<Paginated<TaskView>>(`/tasks?view=open&caseId=${id}&pageSize=50`).then((r) => r.items)
      : Promise.resolve(null),
    seeMoney
      ? apiFetch<Paginated<InvoiceSummaryView>>(`/billing/invoices?caseId=${id}&pageSize=50`).then((r) => r.items)
      : Promise.resolve(null),
  ]);

  const chat = { me: { id: user.id, name: user.fullName }, messages };

  return (
    <CaseView
      detail={detail}
      documents={documents}
      documentsHidden={!seeDocuments}
      chat={chat}
      chatHidden={!seeChat}
      backHref={`/desk/clients/${detail.clientId}`}
      backLabel={`Back to ${detail.clientName}`}
      clientHref={`/desk/clients/${detail.clientId}`}
      canEdit={can(user, 'case.edit')}
      canMove={can(user, 'case.move')}
      canApprove={can(user, 'case.approve')}
      canInvoice={can(user, 'billing.invoice')}
      base="/desk"
      tasks={tasks}
      invoices={invoices}
      assignees={undefined}
      aside={<CaseCommissionCard user={user} detail={detail} />}
    />
  );
}
