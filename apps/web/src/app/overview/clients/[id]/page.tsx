import { requireRole } from '@/lib/session';
import { loadClientPage } from '@/lib/client-page';
import { ClientDetailView } from '@/components/client-detail';
import { StudentPartnerCard } from '@/components/partners/staff-pages';
import { StudentCoursesCard } from '@/components/courses/course-pages';
import { ArchiveClientButton } from '@/components/archive-client-button';

/** The manager's view of a client: the same page as the consultant's, plus archiving and reassignment. */
export default async function ManagerClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('manager');
  const { id } = await params;
  const data = await loadClientPage(id, user);
  return (
    <ClientDetailView
      viewer={user}
      client={data.client}
      base="/overview"
      tasks={data.tasks}
      invoices={data.invoices}
      balance={data.balance}
      assignees={data.assignees}
      checklist={data.checklist}
      aside={
        <>
          <StudentPartnerCard user={user} clientId={data.client.id} />
          <StudentCoursesCard user={user} clientId={data.client.id} />
        </>
      }
      actions={<ArchiveClientButton clientId={data.client.id} archived={data.client.archived} name={data.client.fullName} />}
    />
  );
}
