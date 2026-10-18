import { requireRole } from '@/lib/session';
import { EnquiryPage } from '@/components/courses/student-pages';

export const metadata = { title: 'Course enquiry' };

export default async function DeskCoursesEnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('consultant');
  const { id } = await params;
  return <EnquiryPage user={user} id={id} />;
}
