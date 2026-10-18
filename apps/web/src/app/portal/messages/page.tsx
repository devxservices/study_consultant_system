import { PageStamp } from '@/components/page-stamp';
import type { MessageView } from '@crm/shared';
import { Card, EmptyState } from '@/components/ui';
import { ChatThread } from '@/components/chat-thread';
import { apiFetch } from '@/lib/api';
import { getPortalClient, getPortalCase } from '@/lib/portal';

export const metadata = { title: 'Messages' };

export default async function PortalMessagesPage() {
  const { user, client, firstCase } = await getPortalClient();
  if (!firstCase) {
    return (
      <Card>
        <EmptyState
          title="No application open yet"
          description="Once your application is open you can message your consultant here."
        />
      </Card>
    );
  }

  const [detail, messages] = await Promise.all([
    getPortalCase(firstCase.id),
    apiFetch<MessageView[]>(`/messages?caseId=${firstCase.id}&limit=50`),
  ]);

  // Full-screen conversation: the header and composer are pinned, only the
  // messages scroll. On phones it goes edge-to-edge (WhatsApp-style) by
  // cancelling the shell's page padding (main's pt-1 and pb-6) and reserving
  // the topbar (4rem) + tab bar (4rem); the page footer is hidden there
  // (globals.css), or it would cover the composer. On desktop the padding is
  // kept for breathing room and the footer sits below the fold.
  return (
    <div data-fullscreen-chat className="-mx-4 -mb-6 -mt-1 h-[calc(100dvh-8rem)] sm:-mx-6 lg:mx-0 lg:mb-0 lg:mt-0">
      <PageStamp />
      {client?.consultant ? (
        <ChatThread
          caseId={detail.id}
          me={{ id: user.id, name: user.fullName }}
          counterpartName={client.consultant.name}
          initialMessages={messages}
          fill
        />
      ) : (
        <Card className="m-4">
          <p className="px-4 py-5 text-[14px] text-ink-500">
            A consultant will be assigned to you shortly. You will be able to message them here.
          </p>
        </Card>
      )}
    </div>
  );
}
