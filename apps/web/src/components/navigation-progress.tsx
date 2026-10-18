'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cx } from './ui';

/** A page that lands sooner than this never shows the bar at all. */
const SHOW_AFTER_MS = 120;
/** Never leave a bar running if a navigation is abandoned. */
const GIVE_UP_MS = 10_000;

/**
 * A thin bar across the top while a clicked page is on its way.
 *
 * Navigation keeps the current page on screen until the next one is ready,
 * which is what lets a fast page land in one step with nothing flashing in
 * between. This is the signal for the slow case: it appears only after a
 * beat, so the usual click shows nothing but the page, and it goes the moment
 * the address changes. Clicks on any in-app link start it - rail, rows,
 * breadcrumbs - so no link needs to opt in.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [visible, setVisible] = useState(false);
  const timers = useRef<{ show?: number; giveUp?: number }>({});

  useEffect(() => {
    const stop = () => {
      window.clearTimeout(timers.current.show);
      window.clearTimeout(timers.current.giveUp);
      setVisible(false);
    };

    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
      if (url.pathname === location.pathname && url.search === location.search) return;

      stop();
      timers.current.show = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
      timers.current.giveUp = window.setTimeout(stop, GIVE_UP_MS);
    }

    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      stop();
    };
  }, []);

  // Landed.
  useEffect(() => {
    window.clearTimeout(timers.current.show);
    window.clearTimeout(timers.current.giveUp);
    setVisible(false);
  }, [pathname, search]);

  return (
    <>
      <div aria-hidden className={cx('nav-progress print:hidden', visible && 'nav-progress-on')} />
      <span className="sr-only" role="status">
        {visible ? 'Loading' : ''}
      </span>
    </>
  );
}
