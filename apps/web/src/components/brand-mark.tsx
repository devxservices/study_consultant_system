import type { TenantBranding } from '@crm/shared';
import { MONOGRAM, monogram, monogramFontRatio } from '@/lib/brand';
import { cx } from './ui';

type Branding = Pick<TenantBranding, 'logoUrl'> & Partial<Pick<TenantBranding, 'fullLogoUrl'>>;

/**
 * The consultancy's square icon - the same picture as the browser tab. Its
 * uploaded icon, or its monogram on its brand colour when it has not uploaded
 * one. An uploaded icon sits on a white tile because most are drawn for a
 * white page and would vanish on the dark theme's sidebar.
 */
export function BrandMark({
  name,
  branding,
  size = 38,
  className,
}: {
  name: string;
  branding: Branding | null;
  size?: number;
  className?: string;
}) {
  // The browser-tab icon is drawn from the same proportions, so the two are one mark.
  const box = { width: size, height: size, borderRadius: Math.round(size * MONOGRAM.radius) };

  if (branding?.logoUrl) {
    return (
      <span
        className={cx(
          'flex shrink-0 items-center justify-center overflow-hidden bg-white p-1 shadow-md ring-1 ring-black/5',
          className,
        )}
        style={box}
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny, already sized, served by our own API */}
        <img src={branding.logoUrl} alt="" className="size-full object-contain" decoding="async" />
      </span>
    );
  }

  const initials = monogram(name);
  return (
    <span
      className={cx(
        'flex shrink-0 select-none items-center justify-center bg-gradient-to-br from-brand-500 to-brand-600 font-bold leading-none text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_6px_14px_-6px_var(--color-brand-600)]',
        className,
      )}
      style={{ ...box, fontSize: Math.round(size * monogramFontRatio(initials)), letterSpacing: `${MONOGRAM.tracking}em` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/**
 * The consultancy's wide logo, mark and name together. On the dark theme it
 * sits on a white plate: a logo drawn for a white page would otherwise vanish.
 */
export function FullLogo({
  name,
  url,
  height = 40,
  className,
}: {
  name: string;
  url: string;
  height?: number;
  className?: string;
}) {
  return (
    <span className={cx('brand-plate inline-flex max-w-full shrink-0 items-center', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by our own API, sized by height */}
      <img
        src={url}
        alt={name}
        className="block w-auto max-w-full object-contain object-left"
        style={{ height }}
        decoding="async"
      />
    </span>
  );
}

/**
 * Where there is room for the whole brand: the full logo when one has been
 * uploaded, otherwise the icon with the name beside it.
 */
export function BrandLockup({
  name,
  branding,
  markSize = 38,
  logoHeight = 40,
  nameClassName,
  className,
}: {
  name: string;
  branding: Branding | null;
  markSize?: number;
  logoHeight?: number;
  nameClassName?: string;
  className?: string;
}) {
  if (branding?.fullLogoUrl) {
    return <FullLogo name={name} url={branding.fullLogoUrl} height={logoHeight} className={className} />;
  }
  return (
    <span className={cx('flex min-w-0 items-center gap-3', className)}>
      <BrandMark name={name} branding={branding} size={markSize} />
      <span className={cx('min-w-0 font-bold tracking-[-0.02em] text-ink-950', nameClassName)}>{name}</span>
    </span>
  );
}
