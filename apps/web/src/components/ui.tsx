import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { IconArrowDown, IconArrowUp, IconChevronRight } from './icons';
import { RenderStamp } from './freshness';
import { renderClock } from '@/lib/render-clock';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

/*
 * `press` gives every button the same immediate response: it gives way under
 * the pointer on the first frame of the click, before any request leaves.
 * Hover darkens by filter rather than by swapping to a darker step, because a
 * consultancy's own brand ramp is light at its high steps in dark mode and a
 * white label on it would vanish.
 */
const BUTTON_BASE =
  'press inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-[0_1px_2px_rgb(15_27_53/0.14)] hover:brightness-[0.93] ' +
    'hover:shadow-[0_8px_18px_-8px_var(--color-brand-600)]',
  secondary:
    'border border-line-strong bg-paper text-ink-800 shadow-tile hover:border-ink-300 hover:bg-ink-50 hover:text-ink-950',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-950',
  danger: 'bg-bad-600 text-white hover:brightness-[0.93]',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  // 38px tall: comfortable to tap on a phone without looking oversized on desktop.
  md: 'h-9.5 px-4 text-[14px]',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size]);
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...props} />;
}

/* ------------------------------------------------------------------ */
/* Tones                                                               */
/* ------------------------------------------------------------------ */

/**
 * `info` is the plain "this is a count / for your information" tone. It is a
 * fixed blue rather than the consultancy's brand colour on purpose: a
 * consultancy is free to pick green or red for its buttons, and an
 * informational tag must never be mistaken for a status. The brand colour
 * stays on what you can press.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info';

const TONE_STYLE: Record<Tone, string> = {
  ok: 'bg-ok-50 text-ok-700',
  warn: 'bg-warn-50 text-warn-700',
  bad: 'bg-bad-50 text-bad-700',
  neutral: 'bg-ink-100 text-ink-600',
  info: 'bg-info-50 text-info-700',
};

const DOT_STYLE: Record<Tone, string> = {
  ok: 'bg-ok-500',
  warn: 'bg-warn-500',
  bad: 'bg-bad-500',
  neutral: 'bg-ink-300',
  info: 'bg-info-500',
};

/** The tinted surface a tone owns, for stat cards and icon chips. */
export const TONE_SURFACE: Record<Tone, string> = {
  ok: 'bg-ok-50',
  warn: 'bg-warn-50',
  bad: 'bg-bad-50',
  neutral: 'bg-ink-100',
  info: 'bg-info-50',
};

export const TONE_INK: Record<Tone, string> = {
  ok: 'text-ok-700',
  warn: 'text-warn-700',
  bad: 'text-bad-700',
  neutral: 'text-ink-600',
  info: 'text-info-700',
};

/** A glyph on a tinted tile: the icon itself is the saturated step. */
const TONE_ICON: Record<Tone, string> = {
  ok: 'bg-ok-50 text-ok-600',
  warn: 'bg-warn-50 text-warn-600',
  bad: 'bg-bad-50 text-bad-600',
  neutral: 'bg-ink-100 text-ink-500',
  info: 'bg-info-50 text-info-600',
};

const TONE_FILL: Record<Tone, string> = {
  ok: 'bg-ok-500',
  warn: 'bg-warn-500',
  bad: 'bg-bad-500',
  neutral: 'bg-ink-300',
  info: 'bg-info-500',
};

/** A meter's unfilled track: a lighter step of its own ramp, never grey. */
const TONE_TRACK: Record<Tone, string> = {
  ok: 'bg-ok-100',
  warn: 'bg-warn-100',
  bad: 'bg-bad-100',
  neutral: 'bg-ink-100',
  info: 'bg-info-100',
};

/**
 * Status is always a word, never a bare colour - a colour-blind user and a
 * user glancing at a phone in sunlight both need the label.
 */
export function Pill({
  tone = 'neutral',
  dot = false,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap',
        TONE_STYLE[tone],
        className,
      )}
    >
      {dot && <span className={cx('size-1.5 rounded-full', DOT_STYLE[tone])} aria-hidden />}
      {children}
    </span>
  );
}

/** An icon on a soft tile in a tone's tint - the badge of every stat and list row. */
export function IconTile({
  tone = 'info',
  size = 40,
  className,
  children,
}: {
  tone?: Tone;
  size?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx('flex shrink-0 items-center justify-center rounded-lg', TONE_ICON[tone], className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Avatar                                                              */
/* ------------------------------------------------------------------ */

/**
 * One hue for every person, on purpose. Tinting avatars by person would put a
 * dozen colours on screen and dilute the three that carry meaning; the info
 * tint makes them read as people without competing with status.
 */
export function Avatar({
  name,
  size = 28,
  tone = 'default',
}: {
  name: string;
  size?: number;
  /** `rail` inverts it for the dark navigation plane. */
  tone?: 'default' | 'rail';
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium',
        tone === 'rail' ? 'bg-rail-700 text-rail-ink' : 'bg-info-100 text-info-700',
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page furniture                                                      */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { href?: string; label: string }[];
}) {
  // Every page has a header, so the header carries the page's render stamp
  // (components/freshness.tsx). Only a server render has a clock to give.
  const clock = typeof window === 'undefined' ? renderClock() : null;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pb-5">
      {clock && <RenderStamp {...clock} />}
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5">
            <ol className="flex flex-wrap items-center gap-1 text-[12.5px] text-ink-400">
              {breadcrumb.map((crumb, i) => (
                <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <IconChevronRight size={13} className="text-ink-300" />}
                  {crumb.href ? (
                    <Link href={crumb.href} className="transition-colors hover:text-brand-700">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-ink-500">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink-950">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/*
 * Cards and panels are usually grid items, and a grid item will not shrink
 * below its content's natural width - one truncated line inside would push the
 * whole column past a phone's edge. `min-w-0` lets them shrink and truncate.
 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('min-w-0 rounded-xl bg-paper shadow-card', className)}>{children}</div>;
}

/**
 * A card with a title row. Everything on a dashboard is one of these, so the
 * header spacing is decided once here rather than re-guessed per section.
 */
export function Panel({
  title,
  subtitle,
  action,
  children,
  bodyClassName,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Usually a "see all" link. Kept in the header so rows stay uniform. */
  action?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section className={cx('min-w-0 rounded-xl bg-paper shadow-card', className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-3.5 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-[16px] font-medium leading-6 text-ink-950">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12.5px] text-ink-500">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={cx(bodyClassName ?? 'px-4 pb-4 sm:px-5 sm:pb-5')}>{children}</div>
    </section>
  );
}

/** The "see all" affordance in a panel header, so every one of them matches. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="press group inline-flex h-7.5 items-center gap-1 rounded-md border border-line-strong bg-paper px-2.5 text-[12.5px] font-medium text-ink-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
    >
      {children}
      <IconChevronRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * Empty states say what to do next, not just that a list is empty. A consultant
 * with no clients should see the button that fixes it.
 */
export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'py-16',
      )}
    >
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-info-50 text-info-600 ring-8 ring-info-50/50">
        <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden>
          <path
            d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="text-[15px] font-medium text-ink-900">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A number with its label, for header strips. Deliberately not a giant card. */
export function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  const valueTone =
    tone === 'warn' ? 'text-warn-700' : tone === 'bad' ? 'text-bad-700' : 'text-ink-950';
  return (
    <div className="min-w-0 px-4 py-3 first:pl-0">
      <p className="text-[12.5px] text-ink-500">{label}</p>
      <p className={cx('tnum mt-0.5 text-[22px] font-medium leading-7', valueTone)}>{value}</p>
      {hint && <p className="text-[12px] text-ink-400">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat card                                                           */
/* ------------------------------------------------------------------ */

/**
 * The headline figure at the top of a dashboard: a tinted icon tile and its
 * label, the figure, then how it moved.
 *
 * The tint is not decoration and is never chosen for variety: it is the tone
 * the number already carries everywhere else in the product, so a red tile and
 * a red pill mean the same thing. `info` is the plain "this is a count" case.
 *
 * The whole card is a link when it has somewhere to go - a number a manager
 * wants to act on should not make them hunt for the list behind it.
 */
export function StatCard({
  label,
  value,
  tone = 'info',
  hint,
  delta,
  icon,
  href,
  chart,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
  /** Change against the previous period, as a signed percentage. */
  delta?: { pct: number; label: string; goodWhenUp?: boolean } | null;
  icon?: ReactNode;
  href?: string;
  /** A sparkline. Supporting context only - the figure is the message. */
  chart?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center gap-3">
        {icon && (
          <IconTile tone={tone} size={40} className="transition-transform duration-300 group-hover:scale-105">
            {icon}
          </IconTile>
        )}
        <p className="min-w-0 truncate text-[14px] text-ink-500">{label}</p>
      </div>
      <div className="mt-3.5 flex items-end justify-between gap-3">
        <p className="min-w-0 truncate text-[28px] font-medium leading-none tracking-[-0.02em] text-ink-950">
          {value}
        </p>
        {chart && <div className="shrink-0">{chart}</div>}
      </div>
      {/* The change and what it is measured against, then the caption. A
          delta always names its period, so the two never read as one claim. */}
      <div className="mt-3 min-h-[22px] space-y-1">
        {delta ? <Delta {...delta} /> : null}
        {hint && <p className="truncate text-[12.5px] leading-5 text-ink-400">{hint}</p>}
      </div>
    </>
  );

  const className = cx('group block min-w-0 rounded-xl bg-paper p-4 shadow-card sm:p-5', href && 'lift');

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * A period-on-period change.
 *
 * Direction is carried by an arrow as well as by colour, and "good" is stated
 * per metric rather than assumed: more stalled cases is a rise and a bad one,
 * and a green up-arrow there would be a lie.
 */
export function Delta({
  pct,
  label,
  goodWhenUp = true,
}: {
  pct: number;
  label: string;
  goodWhenUp?: boolean;
}) {
  const flat = Math.round(pct) === 0;
  const up = pct > 0;
  const good = up === goodWhenUp;
  const Arrow = up ? IconArrowUp : IconArrowDown;

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px]">
      <span
        className={cx(
          'tnum inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-px text-[12px] font-medium',
          flat ? 'bg-ink-100 text-ink-500' : good ? 'bg-ok-50 text-ok-700' : 'bg-bad-50 text-bad-700',
        )}
      >
        {!flat && <Arrow size={12} strokeWidth={2.25} />}
        {flat ? 'No change' : `${up ? '+' : ''}${Math.round(pct)}%`}
      </span>
      <span className="truncate text-ink-400">{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Meter                                                               */
/* ------------------------------------------------------------------ */

/**
 * A horizontal load/progress bar. The number is always printed beside it -
 * a bar alone cannot be read precisely, and these are compared between people.
 * The track is a pale step of the fill's own colour, so the state reads across
 * the whole bar, and the fill grows in from the left on arrival.
 */
export function Meter({
  value,
  max = 100,
  tone = 'info',
  className,
  label,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
  return (
    <div
      className={cx('h-1.5 overflow-hidden rounded-full', TONE_TRACK[tone], className)}
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={cx('chart-grow-x h-full rounded-full', TONE_FILL[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The tone a workload percentage carries. Kept here so it is decided once. */
export function loadTone(pct: number): Tone {
  if (pct > 90) return 'bad';
  if (pct > 70) return 'warn';
  return 'ok';
}
