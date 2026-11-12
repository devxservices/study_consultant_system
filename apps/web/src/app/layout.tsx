import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { getSite, siteName } from '@/lib/site';
import { brandCss, monogram } from '@/lib/brand';
import './globals.css';

/**
 * Inter, served from this origin: one 48 KB variable file covers every weight,
 * is preloaded with the page, and is cached for good by its hashed URL. The
 * fallback is size-adjusted to Inter's metrics, so text does not reflow when
 * the font lands.
 */
const inter = localFont({
  src: './fonts/inter-latin-wght.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

/**
 * Every consultancy gets its own name in the tab and its own icon as the
 * favicon, from the same codebase: the site is resolved from the address the
 * page was requested on. Without an uploaded icon the favicon is its monogram,
 * the same mark the collapsed menu shows.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const name = siteName(site);
  const tenant = site.kind === 'tenant' ? site.tenant : null;
  return {
    title: { default: name, template: `%s - ${name}` },
    description: 'Study visa applications, documents and case progress in one place.',
    icons: tenant?.logoUrl ? uploadedIcons(tenant.logoUrl, tenant.touchIconUrl) : monogramIcons(name, tenant?.primaryColor ?? null),
    // A private CRM: no page of it belongs in search results.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The client portal lives on phones; let people zoom the small print.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a20' },
  ],
};

/*
 * Set the theme before the first paint, so a dark-mode user never sees a white
 * flash. It reads the saved choice, falling back to the OS preference, and
 * writes an explicit `data-theme` so the CSS only ever has one selector to
 * match. `suppressHydrationWarning` covers the attribute this adds to <html>.
 */
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const site = await getSite();
  // The consultancy's colour replaces the default brand ramp for the whole
  // page. The platform admin site and unbranded consultancies keep the standard orange.
  const brand = site.kind === 'tenant' ? brandCss(site.tenant.primaryColor) : null;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {brand && <style dangerouslySetInnerHTML={{ __html: brand }} />}
      </head>
      <body>{site.kind === 'unknown' ? <NotConnected /> : children}</body>
    </html>
  );
}

/**
 * An address that maps to no consultancy - a typo, a domain whose DNS points
 * here before anyone registered it, a consultancy's old domain. It renders
 * nothing from any consultancy, including a sign-in form, so there is nothing
 * to try credentials against.
 */
function NotConnected() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <div className="max-w-sm text-center">
        <p className="text-[13px] font-medium uppercase tracking-wide text-ink-400">404</p>
        <h1 className="mt-2 text-[24px] font-bold tracking-[-0.02em] text-ink-950">
          This address is not connected to a consultancy
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-500">
          Check the link you were sent. If you run a consultancy and expected your portal
          here, ask your platform administrator to finish connecting the domain.
        </p>
      </div>
    </main>
  );
}

/**
 * Bump when the monogram's drawing changes: the icon URLs are cached for good,
 * so a new drawing needs new URLs.
 */
const MONOGRAM_DRAWING = '2';

/**
 * The usual set: a 32 px PNG for browsers that want a bitmap, the SVG for the
 * rest (they prefer it), and a 180 px PNG for an iPhone home-screen shortcut.
 */
function monogramIcons(name: string, color: string | null): Metadata['icons'] {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? `&c=${color.slice(1).toLowerCase()}` : '';
  const q = `i=${encodeURIComponent(monogram(name))}${c}&v=${MONOGRAM_DRAWING}`;
  return {
    icon: [
      { url: `/brand-icon?${q}&px=32`, sizes: '32x32', type: 'image/png' },
      { url: `/brand-icon?${q}`, type: 'image/svg+xml' },
    ],
    apple: `/brand-icon/apple?${q}`,
  };
}

/** An uploaded icon is already a 256 px square PNG; iOS gets it on white. */
function uploadedIcons(logoUrl: string, touchIconUrl: string | null): Metadata['icons'] {
  return {
    icon: [{ url: logoUrl, type: 'image/png' }],
    ...(touchIconUrl ? { apple: touchIconUrl } : {}),
  };
}
