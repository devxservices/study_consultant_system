'use client';

import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { cx } from './ui';

/** How long the exit animation plays before the panel unmounts. */
const EXIT_MS = 110;

export interface PopoverTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref: Ref<HTMLButtonElement>;
}

/**
 * Every menu and panel in the chrome: the account menu, the notification
 * panel, "New", the phone's "More".
 *
 * Opening is synchronous with the click - local state, no request, so the
 * panel is on screen in the same frame. It closes on an outside press, on
 * Escape (handing focus back to its button), when a link inside it is
 * followed, and when the route changes; and it plays a short exit rather than
 * vanishing, then unmounts so a closed menu costs nothing.
 */
export function Popover({
  trigger,
  children,
  placement = 'down',
  align = 'right',
  className,
  panelClassName,
  label,
  onOpenChange,
}: {
  /** Renders the button that opens the panel; spread `props` onto it. */
  trigger: (state: { open: boolean; props: PopoverTriggerProps }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: 'down' | 'up';
  align?: 'left' | 'right';
  className?: string;
  panelClassName?: string;
  /** Accessible name for the panel. */
  label: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  const change = useCallback(
    (next: boolean) => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
      setOpen(next);
      if (next) setPresent(true);
      else exitTimer.current = setTimeout(() => setPresent(false), EXIT_MS);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(() => change(false), [change]);

  // A route change means the menu did its job.
  useEffect(() => {
    setOpen(false);
    setPresent(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );

  const props: PopoverTriggerProps = {
    ref: buttonRef,
    type: 'button',
    'aria-expanded': open,
    'aria-controls': present ? id : undefined,
    onClick: () => change(!open),
  };

  return (
    <div ref={wrapRef} className={cx('relative', className)}>
      {trigger({ open, props })}
      {present && (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          data-state={open ? 'open' : 'closed'}
          onClick={(e) => {
            // Following a link inside closes the menu at once rather than
            // when the next page commits.
            if ((e.target as HTMLElement).closest('a[href]')) close();
          }}
          className={cx(
            'absolute z-50 rounded-xl border border-line bg-paper shadow-pop',
            placement === 'down' ? 'popover top-[calc(100%+10px)]' : 'popover-up bottom-[calc(100%+10px)]',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
          style={{
            ['--origin' as string]: `${placement === 'down' ? 'top' : 'bottom'} ${align}`,
          }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
