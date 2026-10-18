import type { PlanView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { PlansEditor } from '@/components/admin/plans-editor';

export const metadata = { title: 'Plans' };

export default async function PlansPage() {
  await requireRole('super_admin');
  const plans = await apiFetch<PlanView[]>('/admin/plans');
  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="What each subscription tier includes. Every consultancy runs the same code; the plan decides which modules are on and how far it can grow."
      />
      <PlansEditor plans={plans} />
    </>
  );
}
