import { PERMISSION_META, type Permission } from '@crm/shared';
import { Card, PageHeader } from './ui';
import { IconLock } from './icons';

/**
 * What a member of staff sees on a page their permissions do not cover. Says
 * which permission it is, so they know exactly what to ask their manager for.
 */
export function NoAccess({ title, permission }: { title: string; permission: Permission }) {
  const meta = PERMISSION_META[permission];
  return (
    <>
      <PageHeader title={title} />
      <Card className="flex flex-col items-center px-6 py-16 text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-ink-100 text-ink-500">
          <IconLock size={22} />
        </span>
        <p className="text-[16px] font-semibold text-ink-950">You don’t have access to this</p>
        <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-ink-500">
          This needs the <span className="font-medium text-ink-800">“{meta.label}”</span> permission.
          Ask a manager if you need it - they can switch it on for you from the team page.
        </p>
      </Card>
    </>
  );
}
