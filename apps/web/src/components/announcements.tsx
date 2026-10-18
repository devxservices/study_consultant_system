import { localIsoDate, AUDIENCE_LABEL, type AnnouncementView } from '@crm/shared';
import { relativeDays } from '@/lib/format';
import { Pill, cx } from './ui';
import { IconMegaphone } from './icons';

/**
 * Notices from the consultancy, pinned ones first. Rendered the same on the
 * portal, the desk and the manager's page; only who sees which ones differs,
 * and the API decides that.
 */
export function AnnouncementFeed({
  items,
  showAudience = false,
  compact = false,
  actions,
}: {
  items: AnnouncementView[];
  showAudience?: boolean;
  compact?: boolean;
  /** Per-item controls, e.g. a delete button on the manager's page. */
  actions?: (a: AnnouncementView) => React.ReactNode;
}) {
  if (items.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-ink-400 sm:px-5">No announcements.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => {
        const expired = a.expiresOn !== null && a.expiresOn < localIsoDate();
        return (
          <li key={a.id} className={cx('flex gap-3 px-4 py-3.5 sm:px-5', expired && 'opacity-60')}>
            <span
              className={cx(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg',
                a.pinned ? 'bg-info-50 text-info-600' : 'bg-ink-100 text-ink-500',
              )}
            >
              <IconMegaphone size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-semibold text-ink-950">{a.title}</p>
                {a.pinned && <Pill tone="info">Pinned</Pill>}
                {showAudience && <Pill tone="neutral">{AUDIENCE_LABEL[a.audience]}</Pill>}
                {expired && <Pill tone="neutral">Expired</Pill>}
              </div>
              <p className={cx('mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-600', compact && 'line-clamp-3')}>
                {a.body}
              </p>
              <p className="mt-1.5 text-[12px] text-ink-400">
                {a.authorName ? `${a.authorName} · ` : ''}
                {relativeDays(a.createdAt)}
                {a.expiresOn && !expired ? ` · until ${new Date(`${a.expiresOn}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
              </p>
            </div>
            {actions && <div className="shrink-0">{actions(a)}</div>}
          </li>
        );
      })}
    </ul>
  );
}
