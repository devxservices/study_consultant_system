import type { TenantBranding } from '@crm/shared';
import { cx } from './ui';

/**
 * The consultancy's logo, or its initial on its brand colour when it has not
 * uploaded one. The logo sits on a white tile because most are drawn for a
 * white page and would vanish on the navy rail.
 */
export function BrandMark({
  name,
  branding,
  size = 38,
  className,
}: {
  name: string;
  branding: Pick<TenantBranding, 'logoUrl'> | null;
  size?: number;
  className?: string;
}) {
  const box = { width: size, height: size };

  if (branding?.logoUrl) {
    return (
      <span
        className={cx(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1 shadow-md ring-1 ring-black/5',
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

  return (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 font-semibold text-white shadow-[0_6px_14px_-6px_var(--color-brand-600)] ring-1 ring-white/15',
        className,
      )}
      style={{ ...box, fontSize: Math.round(size * 0.44) }}
      aria-hidden
    >
      {(name.trim()[0] ?? 'C').toUpperCase()}
    </span>
  );
}
