import { requireRole } from '@/lib/session';
import { loadClientPage } from '@/lib/client-page';
import { ClientDetailView } from '@/components/client-detail';
import { StudentPartnerCard } from '@/components/partners/staff-pages';
import { StudentCoursesCard } from '@/components/courses/course-pages';

export default async function DeskClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  const { id } = await params;
  const data = await loadClientPage(id, user);
  return (
    <ClientDetailView
      viewer={user}
      client={data.client}
      base="/desk"
      tasks={data.tasks}
      invoices={data.invoices}
      balance={data.balance}
      checklist={data.checklist}
      aside={
        <>
          <StudentPartnerCard user={user} clientId={data.client.id} />
          <StudentCoursesCard user={user} clientId={data.client.id} />
        </>
      }
    />
  );
}
