import { Card, EmptyState, LinkButton } from '@/components/ui';

/**
 * Reached both when a client genuinely does not exist and when it belongs to
 * another consultant - the API deliberately does not distinguish the two.
 */
export default function ClientNotFound() {
  return (
    <div className="mx-auto max-w-lg pt-10">
      <Card>
        <EmptyState
          title="Client not found"
          description="This client does not exist, or they are assigned to a different consultant."
          action={<LinkButton href="/desk/clients">Back to my clients</LinkButton>}
        />
      </Card>
    </div>
  );
}
