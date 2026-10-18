'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Avatar, cx } from './ui';
import { Popover } from './popover';
import { NavLink } from './nav-link';
import { SignOutButton } from './sign-out';
import {
  IconBuilding,
  IconChat,
  IconChevronDown,
  IconKey,
  IconMegaphone,
  IconMenu,
  IconPlus,
  IconTasks,
  IconUserPlus,
  IconWallet,
  type IconProps,
} from './icons';

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

export function AccountMenu({
  name,
  email,
  roleLabel,
  accountHref,
}: {
  name: string;
  email: string;
  roleLabel: string;
  accountHref: string;
}) {
  return (
    <Popover
      label="Account"
      panelClassName="w-64 p-1.5"
      trigger={({ open, props }) => (
        <button
          {...props}
          className={cx(
            'press flex h-10 items-center gap-2 rounded-lg bg-paper pl-1 pr-1 shadow-tile sm:pr-2.5',
            open ? 'ring-2 ring-brand-200' : 'hover:bg-ink-50',
          )}
        >
          <Avatar name={name} size={32} />
          <span className="hidden text-left sm:block">
            <span className="block max-w-[140px] truncate text-[13px] font-medium leading-4 text-ink-900">
              {name}
            </span>
            <span className="block text-[11.5px] leading-4 text-ink-400">{roleLabel}</span>
          </span>
          <IconChevronDown
            size={15}
            className={cx('hidden text-ink-400 transition-transform duration-200 sm:block', open && 'rotate-180')}
          />
          <span className="sr-only">Account menu</span>
        </button>
      )}
    >
      <div className="flex items-center gap-3 border-b border-line px-2.5 pb-3 pt-2">
        <Avatar name={name} size={38} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-ink-950">{name}</p>
          <p className="truncate text-[12px] text-ink-400">{email}</p>
        </div>
      </div>
      <div className="space-y-0.5 pt-1.5">
        <Link
          href={accountHref}
          className="press flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-ink-700 hover:bg-ink-50 hover:text-ink-950"
        >
          <IconKey size={16} className="text-ink-400" />
          Account settings
        </Link>
        <SignOutButton />
      </div>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* New                                                                 */
/* ------------------------------------------------------------------ */

export type QuickActionIcon = 'client' | 'invoice' | 'task' | 'announcement' | 'staff' | 'consultancy';

export interface QuickAction {
  href: string;
  label: string;
  hint: string;
  icon: QuickActionIcon;
}

// Looked up here rather than passed in: functions cannot cross from a server
// component to a client one.
const QUICK_ICON: Record<QuickActionIcon, (p: IconProps) => React.JSX.Element> = {
  client: IconUserPlus,
  invoice: IconWallet,
  task: IconTasks,
  announcement: IconMegaphone,
  staff: IconUserPlus,
  consultancy: IconBuilding,
};

/** "New ..." from anywhere: the things people start most, one click away. */
export function QuickCreate({ actions }: { actions: QuickAction[] }) {
  return (
    <Popover
      label="Create new"
      align="left"
      panelClassName="w-72 p-1.5"
      trigger={({ open, props }) => (
        <button
          {...props}
          className={cx(
            'press flex h-10 items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium shadow-tile',
            open ? 'bg-brand-600 text-white brightness-[0.86]' : 'bg-brand-600 text-white hover:brightness-[0.93]',
          )}
        >
          <IconPlus size={18} className={cx('transition-transform duration-200', open && 'rotate-45')} />
          <span className="hidden sm:inline">New</span>
          <span className="sr-only sm:hidden">Create new</span>
        </button>
      )}
    >
      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
        Create
      </p>
      <ul>
        {actions.map((a) => {
          const Glyph = QUICK_ICON[a.icon];
          return (
            <li key={a.href}>
              <Link
                href={a.href}
                className="press group flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-ink-50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-transform duration-200 group-hover:scale-105">
                  <Glyph size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-ink-950">{a.label}</span>
                  <span className="block truncate text-[12px] text-ink-400">{a.hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* The phone's "More"                                                  */
/* ------------------------------------------------------------------ */

export function MoreMenu({
  items,
  siblings,
}: {
  items: { href: string; label: string; badge?: number }[];
  siblings: string[];
}) {
  const waiting = items.reduce((n, i) => n + (i.badge ?? 0), 0);
  return (
    <Popover
      label="More destinations"
      placement="up"
      className="flex flex-1"
      panelClassName="w-60 p-1.5"
      trigger={({ open, props }) => (
        <button
          {...props}
          className={cx(
            'press flex flex-1 flex-col items-center gap-0.5 px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 text-[11.5px] font-medium',
            open ? 'text-brand-600' : 'text-ink-500',
          )}
        >
          <span className="relative">
            <IconMenu size={21} />
            {waiting > 0 && (
              <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-warn-500" aria-hidden />
            )}
          </span>
          More
        </button>
      )}
    >
      {items.map((item) => (
        <NavLink key={item.href} href={item.href} badge={item.badge} siblings={siblings}>
          {item.label}
        </NavLink>
      ))}
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Messages, floating                                                  */
/* ------------------------------------------------------------------ */

/**
 * The conversation is the thing people come back to all day, so it floats in
 * reach on every screen of a wide display - and steps aside on the messages
 * page itself, and on phones, where the bottom bar already carries it.
 */
export function MessagesFab({ href, unread }: { href: string; unread: number }) {
  const pathname = usePathname();
  if (pathname === href || pathname.startsWith(`${href}/`)) return null;

  return (
    <Link
      href={href}
      aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
      className="group fixed bottom-6 right-6 z-30 hidden items-center lg:flex print:hidden"
    >
      <span className="pointer-events-none mr-3 translate-x-2 rounded-lg bg-ink-950 px-2.5 py-1.5 text-[12.5px] font-medium text-paper opacity-0 shadow-pop transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
        Messages
      </span>
      {/* Brand blue, not the reference's amber: amber means "waiting on
          someone" everywhere else in this product. */}
      <span className="press relative flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-[0_12px_26px_-10px_var(--color-brand-600)] transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-95">
        <IconChat size={24} />
        {unread > 0 && (
          <span className="tnum absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-bad-500 px-1 text-[11px] font-semibold text-white ring-2 ring-canvas">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </span>
    </Link>
  );
}
