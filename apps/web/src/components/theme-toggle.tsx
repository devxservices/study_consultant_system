'use client';

import { useEffect, useState } from 'react';
import { cx } from './ui';
import { IconMoon, IconSun } from './icons';

type Theme = 'light' | 'dark';

function write(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* private mode - the choice just won't persist */
  }
}

/**
 * Switches the theme. Where the browser has view transitions the old and new
 * pages cross-fade - a compositor animation of two snapshots, so it costs the
 * page nothing - and anywhere else, or with reduced motion, it switches at once.
 */
function apply(theme: Theme) {
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (doc.startViewTransition && !still) doc.startViewTransition(() => write(theme));
  else write(theme);
}

/**
 * Reads the live theme the no-flash script already set on <html>, so the
 * control shows the right state without a second source of truth. It renders a
 * stable placeholder until mounted, because the server cannot know which theme
 * the browser resolved and a mismatch would flash.
 */
function useTheme(): [Theme | null, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || 'light';
    setTheme(current);
  }, []);

  const set = (t: Theme) => {
    setTheme(t);
    apply(t);
  };

  return [theme, set];
}

/** The segmented Light/Dark control in the rail's footer. The active half slides on a shared track. */
export function ThemeToggle() {
  const [theme, set] = useTheme();
  const active = theme ?? 'light';

  return (
    <div
      className="relative grid grid-cols-2 gap-1 rounded-lg bg-white/[0.05] p-1 ring-1 ring-white/[0.06]"
      role="group"
      aria-label="Colour theme"
    >
      {/* sliding highlight */}
      <span
        aria-hidden
        className={cx(
          'pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-6px)] rounded-md bg-white/[0.1] shadow-sm transition-transform duration-300 ease-smooth',
          active === 'dark' && 'translate-x-[calc(100%+4px)]',
        )}
      />
      <button
        type="button"
        onClick={() => set('light')}
        aria-pressed={active === 'light'}
        className={cx(
          'press relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium',
          active === 'light' ? 'text-rail-ink' : 'text-rail-muted hover:text-rail-ink',
        )}
      >
        <IconSun size={15} />
        Light
      </button>
      <button
        type="button"
        onClick={() => set('dark')}
        aria-pressed={active === 'dark'}
        className={cx(
          'press relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium',
          active === 'dark' ? 'text-rail-ink' : 'text-rail-muted hover:text-rail-ink',
        )}
      >
        <IconMoon size={15} />
        Dark
      </button>
    </div>
  );
}

/**
 * A single icon tile that flips the theme. For the top bar, where the
 * segmented control would be too heavy.
 */
export function ThemeToggleButton({ className }: { className?: string }) {
  const [theme, set] = useTheme();
  const active = theme ?? 'light';
  const next = active === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => set(next)}
      className={cx(
        'press group flex size-10 items-center justify-center rounded-lg bg-paper text-ink-500 shadow-tile hover:text-brand-600',
        className,
      )}
      title={`Switch to ${next} mode`}
    >
      <span className="transition-transform duration-500 ease-spring group-hover:rotate-[20deg]">
        {active === 'dark' ? <IconSun size={19} /> : <IconMoon size={19} />}
      </span>
      <span className="sr-only">Switch to {next} mode</span>
    </button>
  );
}
