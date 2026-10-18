import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { getSite, siteName } from '@/lib/site';
import { brandCss } from '@/lib/brand';
import './globals.css';

/**
 * Rubik, served from this origin: one 35 KB variable file covers every weight,
 * is preloaded with the page, and is cached for good by its hashed URL. The
 * fallback is size-adjusted to Rubik's metrics, so text does not reflow when
 * the font lands.
 */
const rubik = localFont({
  src: './fonts/rubik-latin-wght.woff2',
  variable: '--font-rubik',
  weight: '300 900',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

/**
 * Every consultancy gets its own name in the tab and its own logo as the
 * favicon, from the same codebase: the site is resolved from the address the
 * page was requested on.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const name = siteName(site);
  const logo = site.kind === 'tenant' ? site.tenant.logoUrl : null;
  return {
    title: { default: name, template: `%s - ${name}` },
    description: 'Study visa applications, documents and case progress in one place.',
    ...(logo ? { icons: { icon: logo } } : {}),
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The client portal lives on phones; let people zoom the small print.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f5f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1222' },
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
  // page. The platform admin site and unbranded consultancies keep the standard blue.
  const brand = site.kind === 'tenant' ? brandCss(site.tenant.primaryColor) : null;

  return (
    <html lang="en" className={rubik.variable} suppressHydrationWarning>
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
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.015em] text-ink-950">
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
