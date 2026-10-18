import Link from 'next/link';
import type { RoleTemplateView } from '@crm/shared';
import { requireRole } from '@/lib/session';
import { apiFetch } from '@/lib/api';
import { ConsultantForm } from '@/components/consultant-form';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Add a team member' };

export default async function NewConsultantPage() {
  await requireRole('manager');
  const roles = await apiFetch<RoleTemplateView[]>('/team/roles').catch(() => []);

  return (
    <div>
      <Link
        href="/overview/consultants"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"
      >
        <span aria-hidden>&larr;</span> Back to the team
      </Link>
      <PageHeader
        title="Add a team member"
        subtitle="A counsellor, an accountant, a trainer: add them and pick their role. They get an email to choose their password."
      />
      <ConsultantForm roles={roles} />
    </div>
  );
}
