'use client';

import { useEffect, useState } from 'react';
import { cx } from './ui';
import { IconSidebar } from './icons';

/**
 * Collapses and expands the rail. The collapsed state lives as a `data-collapsed`
 * attribute on `#app-shell` - CSS drives every width and label off it, so the
 * toggle just flips the attribute (and remembers the choice). An inline script
 * in the shell sets the attribute before first paint, so a returning user who
 * left it collapsed never sees it flash open.
 *
 * The switch is instant rather than an animated width: animating a width
 * re-lays-out every chart and table beside the rail on every frame, which is
 * exactly the jank a click should never cause.
 */
export function RailToggle() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = document.getElementById('app-shell');
    if (el) setCollapsed(el.getAttribute('data-collapsed') === 'true');
  }, []);

  const toggle = () => {
    const el = document.getElementById('app-shell');
    if (!el) return;
    const next = el.getAttribute('data-collapsed') !== 'true';
    el.setAttribute('data-collapsed', next ? 'true' : 'false');
    try {
      localStorage.setItem('rail', next ? 'collapsed' : 'expanded');
    } catch {
      /* private mode - the choice just won't persist */
    }
    setCollapsed(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-pressed={collapsed}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="press flex size-9 shrink-0 items-center justify-center rounded-lg text-rail-muted hover:bg-white/[0.07] hover:text-rail-ink"
    >
      <IconSidebar size={19} className={cx('transition-transform duration-200', collapsed && 'rotate-180')} />
    </button>
  );
}
