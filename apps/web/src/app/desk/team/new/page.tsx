import Link from 'next/link';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ConsultantForm } from '@/components/consultant-form';
import { PageHeader } from '@/components/ui';
import { NoAccess } from '@/components/no-access';

export const metadata = { title: 'Add consultant' };

export default async function DeskNewConsultantPage() {
  const user = await requireRole('consultant');
  if (!can(user, 'staff.manage')) return <NoAccess title="Add a team member" permission="staff.manage" />;

  return (
    <div>
      <Link href="/desk/team" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
        <span aria-hidden>&larr;</span> Back to team
      </Link>
      <PageHeader
        title="Add a team member"
        subtitle="They get an email to choose their password. What they can do follows the consultancy’s defaults until a manager changes it."
      />
      <ConsultantForm returnTo="/desk/team" />
    </div>
  );
}
