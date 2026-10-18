import { notFound } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { requireRole } from '@/lib/session';
import type { DocumentView, InvoiceSummaryView, MessageView, Paginated, TaskView } from '@crm/shared';
import { enabledModules } from '@/lib/entitlements';
import { CaseView, type CaseDetail } from '@/components/case-view';
import { CaseCommissionCard } from '@/components/commissions/case-card';

/**
 * Manager drill-down. A manager can move a case too - they are the override of
 * last resort when a consultant is away.
 */
export default async function ManagerCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  const { id } = await params;

  let detail: CaseDetail;
  try {
    detail = await apiFetch<CaseDetail>(`/cases/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }

  const modules = await enabledModules();
  const [documents, messages, tasks, invoices, assignees] = await Promise.all([
    apiFetch<Paginated<DocumentView>>(`/documents?caseId=${id}&pageSize=100&sort=newest`),
    apiFetch<MessageView[]>(`/messages?caseId=${id}&limit=50`),
    modules.has('tasks')
      ? apiFetch<Paginated<TaskView>>(`/tasks?view=open&caseId=${id}&pageSize=50`).then((r) => r.items)
      : Promise.resolve(null),
    modules.has('billing')
      ? apiFetch<Paginated<InvoiceSummaryView>>(`/billing/invoices?caseId=${id}&pageSize=50`).then((r) => r.items)
      : Promise.resolve(null),
    modules.has('tasks') ? apiFetch<{ id: string; name: string }[]>('/tasks/assignees') : Promise.resolve(undefined),
  ]);

  // A manager reading a thread is oversight, but they can step in when a
  // consultant is away, so the composer stays enabled.
  const chat = { me: { id: user.id, name: user.fullName }, messages };

  return (
    <CaseView
      detail={detail}
      documents={documents.items}
      chat={chat}
      backHref={`/overview/clients/${detail.clientId}`}
      backLabel={`Back to ${detail.clientName}`}
      clientHref={`/overview/clients/${detail.clientId}`}
      canEdit
      canApprove
      base="/overview"
      tasks={tasks}
      invoices={invoices}
      assignees={assignees}
      aside={<CaseCommissionCard user={user} detail={detail} />}
    />
  );
}
