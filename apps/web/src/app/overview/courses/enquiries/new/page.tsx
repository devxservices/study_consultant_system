import { requireRole } from '@/lib/session';
import { NewEnquiryPage } from '@/components/courses/student-pages';

export const metadata = { title: 'New enquiry' };

export default async function ManagerCoursesNewEnquiryPage() {
  const user = await requireRole('manager');
  return <NewEnquiryPage user={user} />;
}
