import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import {
  ROLE_HOME,
  ROLE_LABEL,
  type AuthUser,
  type NotificationFeed,
  type TenantBranding,
} from '@crm/shared';
import { getSite, siteBranding, siteName } from '@/lib/site';
import { BrandMark } from './brand-mark';
import { Avatar, cx } from './ui';
import { SignOutButton } from './sign-out';
import { NotificationBell } from './notification-bell';
import { NavLink } from './nav-link';
import { GlobalSearch } from './global-search';
import { ThemeToggle, ThemeToggleButton } from './theme-toggle';
import { RailToggle } from './rail-toggle';
import { PermissionsProvider } from './permissions-context';
import { AccountMenu, MessagesFab, MoreMenu, QuickCreate, type QuickAction } from './shell-menus';
import { IconGlobe } from './icons';
import { NavigationProgress } from './navigation-progress';
import { FreshnessFallback } from './freshness';

export type { QuickAction } from './shell-menus';

export interface NavItem {
  href: string;
  label: string;
  /** Shown as a count badge, e.g. documents waiting to be reviewed. */
  badge?: number;
  /** The rail groups consecutive items under this heading. */
  section?: string;
}

/**
 * One chrome for every portal.
 *
 * A navy navigation rail: people move between a handful of destinations all
 * day, and a rail keeps every one of them one click away while the lit area
 * beside it stays entirely data. Beside it, a top bar of white tiles - search,
 * theme, notifications, the account - that is transparent over the canvas
 * until content scrolls beneath it. On a phone the rail becomes a bottom bar,
 * because the thumb does not reach the top of the screen.
 */
interface ShellProps {
  user: AuthUser;
  nav: NavItem[];
  /** Preloaded on the server so the badge is correct on first paint. */
  notifications: NotificationFeed;
  children: ReactNode;
  /** Where the topbar search box sends its query. Omitted = no search box. */
  searchAction?: string;
  /** The "New" menu. Omitted or empty = no menu. */
  quickActions?: QuickAction[];
  /** The floating messages button, with its unread count. */
  messages?: { href: string; unread: number };
}

/** Every screen inside knows what its viewer may do, for hiding what they cannot. */
export async function AppShell(props: ShellProps) {
  return (
    <PermissionsProvider role={props.user.role} permissions={props.user.permissions ?? []}>
      {/* Both read the address; neither renders anything until it matters. */}
      <Suspense fallback={null}>
        <NavigationProgress />
        <FreshnessFallback />
      </Suspense>
      <ShellBody {...props} />
    </PermissionsProvider>
  );
}

async function ShellBody({
  user,
  nav,
  notifications,
  children,
  searchAction,
  quickActions,
  messages,
}: ShellProps) {
  const railed = nav.length > 1;
  // The consultancy's own name and logo, never the platform's: to a client this
  // is their consultancy's portal.
  const site = await getSite();
  const brand = { name: siteName(site), branding: siteBranding(site) };
  const accountHref = `${ROLE_HOME[user.role]}/account`;
  const account = (
    <AccountMenu
      name={user.fullName}
      email={user.email}
      roleLabel={user.roleTitle ?? ROLE_LABEL[user.role]}
      accountHref={accountHref}
    />
  );

  if (!railed) {
    return (
      <PortalShell notifications={notifications} brand={brand} account={account}>
        {children}
      </PortalShell>
    );
  }

  const hrefs = nav.map((n) => n.href);

  return (
    <div id="app-shell" className="group/shell min-h-dvh" suppressHydrationWarning>
      {/* Restore the collapsed rail before first paint, so a returning user who
          left it closed never sees it flash open. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "(function(){try{if(localStorage.getItem('rail')==='collapsed'){(document.currentScript&&document.currentScript.parentElement||document.getElementById('app-shell')).setAttribute('data-collapsed','true');}}catch(e){}})();",
        }}
      />
      <Rail user={user} nav={nav} brand={brand} />

      <div className="flex min-h-dvh flex-col lg:pl-[264px] group-data-[collapsed=true]/shell:lg:pl-[84px] print:!pl-0">
        <header className="topbar sticky top-0 z-30 print:hidden">
          <div className="flex h-16 items-center gap-2.5 px-4 sm:h-[72px] sm:px-6 xl:px-8">
            {/* The wordmark appears only where the rail is not: on desktop the
                rail already carries it, and repeating it wastes the row. */}
            <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden" title={brand.name}>
              <BrandMark {...brand} size={36} />
            </Link>

            {quickActions && quickActions.length > 0 && (
              <div className="hidden sm:block">
                <QuickCreate actions={quickActions} />
              </div>
            )}

            <div className="flex min-w-0 flex-1 items-center justify-end">
              {searchAction ? <GlobalSearch action={searchAction} /> : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggleButton />
              <NotificationBell initial={notifications} role={user.role} />
              {account}
            </div>
          </div>
        </header>

        <main className="page-enter w-full flex-1 px-4 pb-6 pt-1 sm:px-6 xl:px-8 print:p-0">
          {children}
        </main>

        <Footer name={brand.name} contactEmail={brand.branding?.contactEmail ?? null} accountHref={accountHref} />
      </div>

      {/* Mobile navigation: thumb-reachable, always labelled, never icon-only.
          Four destinations fit a phone's width; the rest sit behind "More". */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/90 shadow-[0_-8px_24px_-16px_rgb(15_27_53/0.3)] backdrop-blur-lg lg:hidden print:hidden"
        aria-label="Main"
      >
        <div className="flex items-stretch justify-around">
          {(nav.length > 5 ? nav.slice(0, 4) : nav).map((item) => (
            <NavLink key={item.href} href={item.href} badge={item.badge} mobile siblings={hrefs}>
              {item.label}
            </NavLink>
          ))}
          {nav.length > 5 && (
            <MoreMenu
              items={nav.slice(4).map(({ href, label, badge }) => ({ href, label, badge }))}
              siblings={hrefs}
            />
          )}
        </div>
      </nav>

      {messages && <MessagesFab href={messages.href} unread={messages.unread} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The rail                                                            */
/* ------------------------------------------------------------------ */

interface Brand {
  name: string;
  branding: TenantBranding | null;
}

/** Consecutive items that share a section heading, in nav order. */
function groupBySection(nav: NavItem[]): { section: string; items: NavItem[] }[] {
  const groups: { section: string; items: NavItem[] }[] = [];
  for (const item of nav) {
    const section = item.section ?? 'Menu';
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.items.push(item);
    else groups.push({ section, items: [item] });
  }
  return groups;
}

function Rail({ user, nav, brand }: { user: AuthUser; nav: NavItem[]; brand: Brand }) {
  const hrefs = nav.map((n) => n.href);
  return (
    <aside
      className="rail-scroll fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col overflow-y-auto bg-rail-950 lg:flex group-data-[collapsed=true]/shell:w-[84px] print:!hidden"
      aria-label="Sidebar"
    >
      {/* A faint wash of the brand colour behind the wordmark. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(110%_70%_at_0%_0%,color-mix(in_oklab,var(--color-brand-600)_28%,transparent),transparent_70%)]"
      />

      <div className="relative flex h-[72px] shrink-0 items-center gap-2.5 px-5 group-data-[collapsed=true]/shell:h-auto group-data-[collapsed=true]/shell:flex-col group-data-[collapsed=true]/shell:gap-3 group-data-[collapsed=true]/shell:px-2 group-data-[collapsed=true]/shell:py-4">
        <Link href="/" className="group flex min-w-0 items-center gap-3" title={brand.name}>
          <BrandMark {...brand} className="transition-transform duration-300 group-hover:scale-105" />
          <span className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-rail-ink group-data-[collapsed=true]/shell:hidden">
            {brand.name}
          </span>
        </Link>
        <span className="ml-auto group-data-[collapsed=true]/shell:ml-0">
          <RailToggle />
        </span>
      </div>

      {/* Who am I signed in as, answered without opening a menu. More support
          calls start with that question than with any other. */}
      <div
        className="relative mx-4 mb-6 mt-1 flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/[0.06] group-data-[collapsed=true]/shell:mx-auto group-data-[collapsed=true]/shell:bg-transparent group-data-[collapsed=true]/shell:p-0 group-data-[collapsed=true]/shell:ring-0"
        title={user.fullName}
      >
        <span className="rounded-full ring-2 ring-white/10">
          <Avatar name={user.fullName} size={36} tone="rail" />
        </span>
        <div className="min-w-0 group-data-[collapsed=true]/shell:hidden">
          <p className="truncate text-[13.5px] font-medium leading-5 text-rail-ink">{user.fullName}</p>
          <p className="truncate text-[12px] leading-4 text-rail-muted">{user.roleTitle ?? ROLE_LABEL[user.role]}</p>
        </div>
      </div>

      <nav className="relative flex-1 space-y-6 px-3 group-data-[collapsed=true]/shell:space-y-3 group-data-[collapsed=true]/shell:px-2" aria-label="Main">
        {groupBySection(nav).map((group, i) => (
          <div key={group.section}>
            <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-rail-dim group-data-[collapsed=true]/shell:hidden">
              {group.section}
            </p>
            {i > 0 && (
              <span aria-hidden className="mx-auto mb-3 hidden h-px w-8 bg-rail-line group-data-[collapsed=true]/shell:block" />
            )}
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink href={item.href} badge={item.badge} rail siblings={hrefs}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="relative mt-6 space-y-2 border-t border-rail-line p-3 group-data-[collapsed=true]/shell:px-2">
        {/* The segmented control needs room for two labels; when the rail is
            narrow the theme lives on the topbar's tile instead. */}
        <div className="group-data-[collapsed=true]/shell:hidden">
          <ThemeToggle />
        </div>
        <SignOutButton rail />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function Footer({
  name,
  contactEmail,
  accountHref,
}: {
  name: string;
  contactEmail: string | null;
  accountHref: string;
}) {
  return (
    <footer data-shell-footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-24 pt-3 text-[12.5px] text-ink-400 sm:px-6 lg:pb-6 xl:px-8 print:hidden">
      <p>
        &copy; {new Date().getFullYear()} <span className="text-ink-600">{name}</span>. All rights reserved.
      </p>
      <p className="flex items-center gap-2">
        <Link href={accountHref} className="font-medium text-brand-600 transition-colors hover:text-brand-700">
          Account settings
        </Link>
        {contactEmail && (
          <>
            <span aria-hidden className="text-ink-300">
              /
            </span>
            <a
              href={`mailto:${contactEmail}`}
              className="font-medium text-brand-600 transition-colors hover:text-brand-700"
            >
              Contact
            </a>
          </>
        )}
      </p>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* A shell with a single destination                                   */
/* ------------------------------------------------------------------ */

/**
 * For a portal with only one place to go: a rail with one item is decoration,
 * so it gets a top bar and a centred column instead.
 */
function PortalShell({
  notifications,
  brand,
  account,
  children,
}: {
  notifications: NotificationFeed;
  brand: Brand;
  account: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="topbar sticky top-0 z-30">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link href="/portal" className="flex min-w-0 items-center gap-2.5">
            <BrandMark {...brand} />
            <span className="truncate text-[15px] font-medium text-ink-950">{brand.name}</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggleButton />
            <NotificationBell initial={notifications} role="client" />
            {account}
          </div>
        </div>
      </header>
      <main className={cx('page-enter mx-auto max-w-3xl px-4 py-5 pb-12')}>{children}</main>
      <footer className="mx-auto flex max-w-3xl items-center gap-2 px-4 pb-8 text-[12px] text-ink-400">
        <IconGlobe size={14} />
        Your consultant sees everything on this page too.
      </footer>
    </div>
  );
}
