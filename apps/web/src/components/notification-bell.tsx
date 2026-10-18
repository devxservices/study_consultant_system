'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_TONE,
  type NotificationFeed,
  type NotificationView,
  type Role,
} from '@crm/shared';
import { cx } from './ui';
import { Popover } from './popover';
import { IconBell } from './icons';
import { connectSocket } from '@/lib/socket';
import { relativeDays } from '@/lib/format';
import { portalLink } from '@/lib/portal-link';

const DOT: Record<string, string> = {
  ok: 'bg-ok-500',
  warn: 'bg-warn-500',
  bad: 'bg-bad-500',
  neutral: 'bg-ink-300',
};

/**
 * The bell.
 *
 * Notifications arrive over a socket so a consultant does not have to reload to
 * discover a client uploaded something. The row in the database is the source
 * of truth; the socket only saves a refresh, so a missed event costs nothing
 * more than a slightly stale badge until the next page load.
 *
 * Everything the person does here is optimistic: the panel opens on the click
 * with the feed already in memory (a fresh copy is fetched behind it), and
 * marking read clears the badge before the request is sent.
 */
export function NotificationBell({ initial, role }: { initial: NotificationFeed; role: Role }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationView[]>(initial.items);
  const [unread, setUnread] = useState(initial.unread);
  const [fresh, setFresh] = useState(false);

  useEffect(
    () =>
      connectSocket('/notifications', (socket) => {
        socket.on(NOTIFICATION_EVENTS.created, (n: NotificationView) => {
          setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 20)));
          setUnread((u) => u + 1);
          setFresh(true);
        });

        // Another tab cleared the bell.
        socket.on(NOTIFICATION_EVENTS.readAll, () => {
          setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
          setUnread(0);
        });
      }),
    [],
  );

  async function refresh() {
    try {
      const res = await fetch('/api/notifications?limit=20');
      if (!res.ok) return;
      const feed = (await res.json()) as NotificationFeed;
      setItems(feed.items);
      setUnread(feed.unread);
    } catch {
      /* keep whatever we have */
    }
  }

  async function markAllRead() {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    await fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => null);
  }

  async function openNotification(n: NotificationView, close: () => void) {
    close();
    if (!n.readAt) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void fetch(`/api/notifications/${n.id}/read`, { method: 'POST' }).catch(() => null);
    }
    if (n.link) {
      router.push(portalLink(n.link, role));
      router.refresh();
    }
  }

  return (
    <Popover
      label="Notifications"
      onOpenChange={(open) => {
        if (open) {
          setFresh(false);
          void refresh();
        }
      }}
      panelClassName="w-[min(380px,calc(100vw-2rem))] overflow-hidden"
      trigger={({ open, props }) => (
        <button
          {...props}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className={cx(
            'press group relative flex size-10 items-center justify-center rounded-lg shadow-tile',
            open ? 'bg-brand-600 text-white' : 'bg-paper text-ink-500 hover:text-brand-600',
          )}
        >
          <IconBell
            size={19}
            className={cx('origin-top transition-transform', fresh && 'animate-[bell_0.9s_ease-in-out]')}
          />
          {unread > 0 && (
            <span className="tnum absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad-500 px-1 text-[10px] font-semibold text-white ring-2 ring-canvas">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-[14px] font-medium text-ink-950">
              Notifications
              {unread > 0 && (
                <span className="tnum ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px] font-medium text-brand-700">
                  {unread} new
                </span>
              )}
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="press rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-brand-700 hover:bg-brand-50"
              >
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <IconBell size={20} />
              </span>
              <p className="text-[13.5px] font-medium text-ink-800">You are all caught up</p>
              <p className="mt-0.5 text-[12.5px] text-ink-400">
                Document reviews, stage changes and messages appear here.
              </p>
            </div>
          ) : (
            <ul className="max-h-[min(440px,60vh)] divide-y divide-line overflow-y-auto overscroll-contain">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void openNotification(n, close)}
                    className={cx(
                      'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50',
                      !n.readAt && 'bg-brand-50/60',
                    )}
                  >
                    <span
                      className={cx(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        n.readAt ? 'bg-transparent' : DOT[NOTIFICATION_TONE[n.type]],
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cx(
                          'block text-[13px] leading-snug',
                          n.readAt ? 'text-ink-700' : 'font-medium text-ink-950',
                        )}
                      >
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 block truncate text-[12px] text-ink-500">{n.body}</span>
                      )}
                      <span className="mt-0.5 block text-[11.5px] text-ink-400">
                        {relativeDays(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Popover>
  );
}
