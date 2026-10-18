'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cx } from './ui';
import { NAV_ICON } from './icons';
import { prefetchOnIntent } from './freshness';

/** A pointer resting this long on a destination means it is wanted. */
const HOVER_INTENT_MS = 60;
/** Keyboard focus moves fast through a rail; wait to see where it stops. */
const FOCUS_INTENT_MS = 150;

/**
 * Fetch a destination in full as soon as someone shows they want it, so the
 * click finds the page already here. Sweeping the mouse across the rail
 * fetches nothing; a touch is intent the moment it lands. The rail's
 * destinations are lists and dashboards - none records a view in the audit
 * trail, which is why record pages are never prefetched like this.
 */
function useIntentPrefetch(href: string, pathname: string) {
  const router = useRouter();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const now = () => {
    window.clearTimeout(timer.current);
    if (href !== pathname) prefetchOnIntent(router, href);
  };
  const soon = (ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(now, ms);
  };
  const cancel = () => window.clearTimeout(timer.current);

  return {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') soon(HOVER_INTENT_MS);
    },
    onPointerLeave: cancel,
    onPointerDown: now,
    onFocus: () => soon(FOCUS_INTENT_MS),
    onBlur: cancel,
  };
}

/**
 * The destination someone has just clicked, before the router has got there.
 *
 * The highlight moves on the click itself rather than when the next page
 * commits, so the menu answers in the same frame however long the page takes.
 * One tiny store shared by every link in the rail and the bottom bar, cleared
 * as soon as the path actually changes.
 */
let pendingHref: string | null = null;
const listeners = new Set<() => void>();

function setPendingHref(href: string | null) {
  if (pendingHref === href) return;
  pendingHref = href;
  listeners.forEach((notify) => notify());
}

function usePendingHref(): string | null {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => pendingHref,
    () => null,
  );
}

/**
 * Active state is derived from the path rather than passed in, so a page deep
 * inside a section still highlights its section.
 *
 * The rule is longest-prefix-wins across the whole nav, which is the only one
 * that survives nested destinations: `/desk` is a section root that prefixes
 * every other item, so without this both "Dashboard" and "Clients" would light
 * up on `/desk/clients`. A path under a section root with no nav item of its
 * own - a case detail page, say - correctly falls back to the root.
 */
function isActive(pathname: string, href: string, siblings: string[]): boolean {
  const matches = (candidate: string) =>
    pathname === candidate || pathname.startsWith(`${candidate}/`);
  if (!matches(href)) return false;
  return !siblings.some((s) => s !== href && s.length > href.length && matches(s));
}

function plainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** A small spinner while the page behind a clicked link is on its way. */
function PendingMark({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className={cx(
        'size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-r-transparent opacity-70',
        className,
      )}
    />
  );
}

export function NavLink({
  href,
  children,
  badge,
  mobile = false,
  rail = false,
  siblings = [],
}: {
  href: string;
  children: ReactNode;
  badge?: number;
  mobile?: boolean;
  rail?: boolean;
  /** Every href in the same nav, so longest-prefix-wins can be resolved. */
  siblings?: string[];
}) {
  // The glyph is looked up here rather than passed in: a component is a
  // function, and functions do not survive the server-to-client boundary.
  const IconComponent = NAV_ICON[href];
  const pathname = usePathname();
  const pending = usePendingHref();
  const active = isActive(pending ?? pathname, href, siblings);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  const intent = useIntentPrefetch(href, pathname);

  const onClick = (e: MouseEvent) => {
    if (plainClick(e)) setPendingHref(href);
  };

  if (rail) {
    return (
      <Link
        href={href}
        onClick={onClick}
        {...intent}
        aria-current={active ? 'page' : undefined}
        title={typeof children === 'string' ? children : undefined}
        className={cx(
          'group/nav press relative flex h-11 items-center gap-3 rounded-lg px-3 text-[14px] group-data-[collapsed=true]/shell:justify-center group-data-[collapsed=true]/shell:px-0',
          active
            ? 'bg-white/[0.08] font-medium text-white'
            : 'text-rail-muted hover:bg-white/[0.05] hover:text-rail-ink',
        )}
      >
        {/* The active marker: a bar of the brand colour on the rail's edge. */}
        <span
          aria-hidden
          className={cx(
            'absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-brand-400 transition-[opacity,transform] duration-200 group-data-[collapsed=true]/shell:-left-2',
            active ? 'scale-y-100 opacity-100' : 'scale-y-50 opacity-0',
          )}
        />
        {IconComponent && (
          <IconComponent
            size={19}
            className={cx(
              'shrink-0 transition-[color,transform] duration-200',
              active ? 'text-brand-400' : 'text-rail-dim group-hover/nav:text-rail-ink',
            )}
          />
        )}
        <span className="truncate transition-transform duration-200 group-hover/nav:translate-x-0.5 group-data-[collapsed=true]/shell:hidden">
          {children}
        </span>
        <PendingMark className="ml-auto group-data-[collapsed=true]/shell:hidden" />
        {badge ? (
          <span
            className={cx(
              'tnum ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none group-data-[collapsed=true]/shell:hidden',
              active ? 'bg-white/15 text-white' : 'bg-warn-500 text-rail-950',
            )}
          >
            {badge > 99 ? '99+' : badge}
            <span className="sr-only"> waiting</span>
          </span>
        ) : null}
        {/* When collapsed, a badge still needs to register - a dot, not a number. */}
        {badge ? (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 hidden size-2 rounded-full bg-warn-500 ring-2 ring-rail-950 group-data-[collapsed=true]/shell:block"
          />
        ) : null}
      </Link>
    );
  }

  if (mobile) {
    return (
      <Link
        href={href}
        onClick={onClick}
        {...intent}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'press relative flex flex-1 flex-col items-center gap-0.5 px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 text-[11.5px] font-medium',
          active ? 'text-brand-600' : 'text-ink-500',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-brand-500 transition-[opacity,transform] duration-200',
            active ? 'scale-x-100 opacity-100' : 'scale-x-50 opacity-0',
          )}
        />
        <span className="relative">
          {IconComponent ? <IconComponent size={21} /> : null}
          {badge ? (
            <span className="tnum absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-warn-500 px-1 text-center text-[10px] font-semibold leading-4 text-rail-950">
              {badge > 99 ? '99+' : badge}
            </span>
          ) : null}
        </span>
        <span className="truncate">{children}</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      {...intent}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'press flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium',
        active ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-950',
      )}
    >
      {IconComponent ? <IconComponent size={17} className="shrink-0 opacity-80" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <PendingMark />
      {badge ? (
        <span className="tnum rounded-full bg-warn-100 px-1.5 py-px text-[11px] font-semibold text-warn-700">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
