import { requireRole } from '@/lib/session';
import { ReportPage } from '@/components/finance/reports-pages';

export const metadata = { title: 'Report' };

export default async function DeskReportPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ from?: string; to?: string; currency?: string }> }) {
  const user = await requireRole('consultant');
  return <ReportPage user={user} name={(await params).name} query={await searchParams} />;
}
