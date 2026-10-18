import Link from 'next/link';
import type { ThreadSummary } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { requireRole } from '@/lib/session';
import { can } from '@/lib/permissions';
import { NoAccess } from '@/components/no-access';
import { Avatar, Card, EmptyState, LinkButton, PageHeader, cx } from '@/components/ui';
import { relativeDays } from '@/lib/format';

export const metadata = { title: 'Messages' };

/**
 * The consultant's inbox. Only cases with an actual conversation appear -
 * fifty silent threads is noise, not an inbox.
 */
export default async function MessagesPage() {
  const user = await requireRole('consultant');
  if (!can(user, 'chat.view')) return <NoAccess title="Messages" permission="chat.view" />;
  const threads = await apiFetch<ThreadSummary[]>('/messages/threads');

  const unread = threads.filter((t) => t.unread > 0).length;

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle={
          unread > 0
            ? `${unread} conversation${unread === 1 ? '' : 's'} waiting on a reply.`
            : 'Your conversations with clients.'
        }
      />

      {threads.length === 0 ? (
        <Card>
          <EmptyState
            title="No conversations yet"
            description="When a client messages you, or you open a chat from their case, the thread appears here."
            action={<LinkButton href="/desk/clients">Back to clients</LinkButton>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {threads.map((t) => (
              <li key={t.caseId}>
                <Link
                  href={`/desk/cases/${t.caseId}#chat`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-brand-50/40"
                >
                  <Avatar name={t.clientName} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p
                        className={cx(
                          'truncate text-[14px]',
                          t.unread > 0 ? 'font-semibold text-ink-950' : 'font-medium text-ink-800',
                        )}
                      >
                        {t.clientName}
                      </p>
                      <span className="shrink-0 text-[12px] text-ink-400">
                        {relativeDays(t.lastMessageAt)}
                      </span>
                    </div>
                    <p
                      className={cx(
                        'mt-0.5 truncate text-[13px]',
                        t.unread > 0 ? 'text-ink-700' : 'text-ink-400',
                      )}
                    >
                      {t.lastSenderRole !== 'client' && (
                        <span className="text-ink-400">You: </span>
                      )}
                      {t.lastMessage}
                    </p>
                  </div>
                  {t.unread > 0 && (
                    <span className="tnum mt-1 shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {t.unread}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
