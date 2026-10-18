import { requireRole } from '@/lib/session';
import { NewEnquiryPage } from '@/components/courses/student-pages';

export const metadata = { title: 'New enquiry' };

export default async function DeskCoursesNewEnquiryPage() {
  const user = await requireRole('consultant');
  return <NewEnquiryPage user={user} />;
}
