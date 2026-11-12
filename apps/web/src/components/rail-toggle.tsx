'use client';

import { useEffect, useState } from 'react';
import { IconChevronRight } from './icons';

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

  // Hangs over the rail's right edge, centred on the brand row, so the brand
  // gets the whole row. The arrow's direction comes from CSS, so it is right
  // from the first paint; the spoken label follows once the page is live.
  // A plain button with a label that says what it will do - not aria-pressed,
  // which with a changing label would read as "Expand sidebar, pressed".
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-controls="app-rail"
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="press absolute right-0 top-1/2 z-10 flex size-7 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-rail-700 bg-rail-950 text-rail-muted shadow-[0_2px_6px_-1px_rgb(0_0_0/0.12)] hover:border-brand-500 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <IconChevronRight
        size={15}
        className="rotate-180 transition-transform duration-200 group-data-[collapsed=true]/shell:rotate-0"
      />
    </button>
  );
}
