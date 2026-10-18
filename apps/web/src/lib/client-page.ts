import { notFound } from 'next/navigation';
import type { AuthUser, BillingTotals, InvoiceSummaryView, Paginated, StudentChecklistView, TaskView } from '@crm/shared';
import { can } from './permissions';
import type { ClientDetail } from '@/components/client-detail';
import { ApiError, apiFetch } from './api';
import { enabledModules } from './entitlements';

/**
 * Everything the client page shows, fetched in parallel, with each optional
 * module only asked for when the plan includes it. A client this person may
 * not see is a 404 - the same answer as one that does not exist.
 */
export async function loadClientPage(id: string, viewer: AuthUser) {
  const manager = viewer.role === 'manager';
  let client: ClientDetail;
  try {
    client = await apiFetch<ClientDetail>(`/clients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const modules = await enabledModules();
  // Money only for those who may see it; null hides the panel entirely.
  const billing = modules.has('billing') && can(viewer, 'billing.view');

  const [tasks, invoices, totals, assignees, checklist] = await Promise.all([
    modules.has('tasks')
      ? apiFetch<Paginated<TaskView>>(`/tasks?view=open&clientId=${id}&pageSize=50`).then((r) => r.items)
      : Promise.resolve(null),
    billing
      ? apiFetch<Paginated<InvoiceSummaryView>>(`/billing/invoices?clientId=${id}&pageSize=50`).then((r) => r.items)
      : Promise.resolve(null),
    billing
      ? apiFetch<BillingTotals[]>(`/billing/totals?clientId=${id}`)
      : Promise.resolve([] as BillingTotals[]),
    manager && modules.has('tasks')
      ? apiFetch<{ id: string; name: string }[]>('/tasks/assignees')
      : Promise.resolve(undefined),
    can(viewer, 'document.view')
      ? apiFetch<StudentChecklistView>(`/drive/students/${id}/checklist`).catch(() => null)
      : Promise.resolve(null),
  ]);

  return { client, tasks, invoices, balance: totals[0] ?? null, assignees, modules, checklist };
}
