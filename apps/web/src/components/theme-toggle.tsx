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

/**
 * The top bar's theme switch, as the reference draws it: a pale pill holding
 * a sun and a moon, the live one lifted on a white disc - the sun in warm
 * yellow, the moon in the brand. The disc slides between the two. On a phone,
 * where the top bar is short of room, it folds to one round button that flips.
 */
export function ThemeToggleButton({ className }: { className?: string }) {
  const [theme, set] = useTheme();
  const active = theme ?? 'light';
  const next = active === 'dark' ? 'light' : 'dark';

  return (
    <>
      <button
        type="button"
        onClick={() => set(next)}
        className={cx(
          'press flex size-10 items-center justify-center rounded-full bg-ink-50 sm:hidden',
          active === 'dark' ? 'text-brand-500' : 'text-[#efb02e]',
          className,
        )}
        title={`Switch to ${next} mode`}
      >
        {active === 'dark' ? <IconMoon size={18} /> : <IconSun size={18} />}
        <span className="sr-only">Switch to {next} mode</span>
      </button>
      <ThemePill active={active} set={set} className={className} />
    </>
  );
}

function ThemePill({ active, set, className }: { active: Theme; set: (t: Theme) => void; className?: string }) {
  return (
    <div
      className={cx('relative hidden h-10 items-center gap-0.5 rounded-full bg-ink-50 p-1 sm:flex', className)}
      role="group"
      aria-label="Colour theme"
    >
      {/* the sliding disc */}
      <span
        aria-hidden
        className={cx(
          'pointer-events-none absolute left-1 top-1 size-8 rounded-full bg-paper shadow-tile transition-transform duration-300 ease-smooth',
          active === 'dark' && 'translate-x-[34px]',
        )}
      />
      <button
        type="button"
        onClick={() => set('light')}
        aria-pressed={active === 'light'}
        title="Light mode"
        className={cx(
          'press relative z-10 flex size-8 items-center justify-center rounded-full',
          active === 'light' ? 'text-[#efb02e]' : 'text-ink-400 hover:text-ink-700',
        )}
      >
        <IconSun size={18} />
        <span className="sr-only">Light mode</span>
      </button>
      <button
        type="button"
        onClick={() => set('dark')}
        aria-pressed={active === 'dark'}
        title="Dark mode"
        className={cx(
          'press relative z-10 flex size-8 items-center justify-center rounded-full',
          active === 'dark' ? 'text-brand-500' : 'text-ink-500 hover:text-ink-800',
        )}
      >
        <IconMoon size={18} />
        <span className="sr-only">Dark mode</span>
      </button>
    </div>
  );
}
