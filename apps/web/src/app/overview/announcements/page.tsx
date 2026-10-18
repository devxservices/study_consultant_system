import type { AnnouncementView } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { Card, PageHeader, Panel } from '@/components/ui';
import { AnnouncementFeed } from '@/components/announcements';
import { AnnouncementForm } from '@/components/announcement-form';
import { ActionButton } from '@/components/forms';

export const metadata = { title: 'Announcements' };

export default async function AnnouncementsPage() {
  await requireRole('manager');
  const items = await apiFetch<AnnouncementView[]>('/announcements/all');

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Notices for your clients, your staff, or everyone. They appear on dashboards and in the bell."
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Published" subtitle={`${items.length} notice${items.length === 1 ? '' : 's'}`} bodyClassName="">
          <AnnouncementFeed
            items={items}
            showAudience
            actions={(a) => (
              <ActionButton
                url={`/api/announcements/${a.id}`}
                method="DELETE"
                variant="ghost"
                confirm={`Remove "${a.title}"? It disappears for everyone.`}
              >
                Remove
              </ActionButton>
            )}
          />
        </Panel>
        <Card className="p-4 sm:p-5">
          <h2 className="mb-4 text-[15px] font-semibold text-ink-950">New announcement</h2>
          <AnnouncementForm />
        </Card>
      </div>
    </>
  );
}
