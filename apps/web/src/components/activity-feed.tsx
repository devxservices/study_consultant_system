import Link from 'next/link';
import { AUDIT_ACTION_LABEL, type AuditAction } from '@crm/shared';
import { Avatar, EmptyState, cx } from './ui';
import { relativeDays } from '@/lib/format';
import {
  IconCheck,
  IconClose,
  IconFile,
  IconChat,
  IconChevronRight,
  IconUser,
  type IconProps,
} from './icons';

export interface ActivityItem {
  id: string;
  action: string;
  caseId: string | null;
  clientId: string | null;
  clientName: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
}

/**
 * Which glyph and tone an action wears.
 *
 * Tone is the same three-colour vocabulary as everywhere else: green means it
 * completed, red means it was refused, amber means someone is now waiting.
 * Anything that is simply a record of work carries no colour at all - a feed
 * where every row is coloured is a feed where colour has stopped meaning
 * anything.
 */
const ACTION_STYLE: Record<
  string,
  { icon: (p: IconProps) => React.JSX.Element; tone: 'ok' | 'warn' | 'bad' | 'neutral' }
> = {
  'document.verified': { icon: IconCheck, tone: 'ok' },
  'document.rejected': { icon: IconClose, tone: 'bad' },
  'document.uploaded': { icon: IconFile, tone: 'warn' },
  'document.commented': { icon: IconChat, tone: 'neutral' },
  'document.deleted': { icon: IconClose, tone: 'neutral' },
  'case.stage_advanced': { icon: IconCheck, tone: 'ok' },
  'case.stage_overridden': { icon: IconChevronRight, tone: 'warn' },
  'case.created': { icon: IconFile, tone: 'neutral' },
  'case.status_changed': { icon: IconChevronRight, tone: 'neutral' },
  'client.created': { icon: IconUser, tone: 'neutral' },
  'client.reassigned': { icon: IconUser, tone: 'warn' },
};

/** The tone an audited action wears, wherever it is listed. */
export function actionTone(action: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  return ACTION_STYLE[action]?.tone ?? 'neutral';
}

const CHIP: Record<'ok' | 'warn' | 'bad' | 'neutral', string> = {
  ok: 'bg-ok-50 text-ok-600',
  warn: 'bg-warn-50 text-warn-600',
  bad: 'bg-bad-50 text-bad-600',
  neutral: 'bg-ink-100 text-ink-500',
};

/**
 * What has happened lately, newest first.
 *
 * Each row names the actor, because "document verified" without "by whom" is
 * the thing this product exists to stop people arguing about. Rows link to the
 * case they happened on where there is one.
 */
export function ActivityFeed({
  items,
  caseHrefBase,
}: {
  items: ActivityItem[];
  /** e.g. `/overview/cases` - the id is appended. */
  caseHrefBase: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title="Nothing has happened yet"
        description="Uploads, reviews and stage changes will appear here as they happen."
      />
    );
  }

  return (
    <ul className="-mx-1">
      {items.map((item) => {
        const style = ACTION_STYLE[item.action] ?? {
          icon: IconChevronRight,
          tone: 'neutral' as const,
        };
        const Glyph = style.icon;
        const label = AUDIT_ACTION_LABEL[item.action as AuditAction] ?? item.action;
        const inner = (
          <>
            <span
              className={cx(
                'flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105',
                CHIP[style.tone],
              )}
            >
              <Glyph size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-ink-900">
                {label}
                {item.clientName ? (
                  <span className="text-ink-500"> &middot; {item.clientName}</span>
                ) : null}
              </span>
              <span className="block truncate text-[12px] text-ink-400">
                {item.actorName ?? 'System'} &middot; {relativeDays(item.createdAt)}
              </span>
            </span>
          </>
        );

        return (
          <li key={item.id}>
            {item.caseId ? (
              <Link
                href={`${caseHrefBase}/${item.caseId}`}
                className="group flex items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-ink-50"
              >
                {inner}
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-1.5 py-2">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
