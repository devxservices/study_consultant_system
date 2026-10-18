'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import type { RenderClock } from '@/lib/render-clock';

/*
 * Keeping reused pages honest.
 *
 * The browser keeps pages it has recently shown (next.config `staleTimes`), so
 * going back to a tab is instant instead of a round trip. A kept page is
 * shown at once and then checked: "has anything in this consultancy changed
 * since this page was rendered?" - one small request answered from a single
 * row. If so, the page is re-rendered in place a moment later; if not, the
 * kept copy is already right and nothing more is fetched.
 *
 * A page carries its render's clock and id (RenderStamp, placed by
 * PageHeader or PageStamp). An id seen before means the page came out of the
 * browser's keep; a new id means it was just rendered - unless it was
 * prefetched on hover a while ago, which is checked the same way.
 */

/** A page prefetched this recently is trusted as it is. */
const FRESH_MS = 2_000;
/** How long the router keeps a full prefetch: next.config staleTimes.static. */
const PREFETCH_KEPT_MS = 60_000;
/** After this long in a background tab, the page is re-checked when looked at again. */
const AWAY_MS = 15_000;

/** Render id -> when it was first shown. */
const shown = new Map<string, number>();
/** Href -> when a full prefetch was last asked for. */
const prefetched = new Map<string, number>();

let current: RenderClock | null = null;
/** The address the last stamp registered on, and when - for FreshnessFallback. */
let stampedKey = '';
let stampedAt = 0;
let refresh: (() => void) | null = null;
let inflight: AbortController | null = null;
let hiddenAt = 0;
let listening = false;

async function check(clock: RenderClock): Promise<void> {
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  try {
    const res = await fetch(`/api/sync/changes?since=${Math.floor(clock.at)}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    // Signed out, or access changed: re-rendering lets the server decide
    // where they belong.
    if (res.status === 401 || res.status === 403) return refresh?.();
    // Cannot tell (rate-limited, server trouble): keep the page rather than
    // swap it for an error - it is at most a minute old.
    if (!res.ok) return;
    const { changed } = (await res.json()) as { changed: boolean };
    if (changed && current?.id === clock.id) refresh?.();
  } catch {
    // Aborted by a newer check, or offline: keep showing what we have.
  } finally {
    if (inflight === controller) inflight = null;
  }
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (current && hiddenAt && Date.now() - hiddenAt > AWAY_MS) {
      void check(current);
    }
  });
  // Restored whole from the browser's back-forward cache.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && current) void check(current);
  });
}

/**
 * Prefetch a destination in full when someone shows intent (hover, focus,
 * touch), so the click itself has nothing left to wait for.
 */
export function prefetchOnIntent(router: ReturnType<typeof useRouter>, href: string): void {
  const asked = prefetched.get(href);
  // The router still holds the last one; asking again would not refetch.
  if (asked !== undefined && Date.now() - asked < PREFETCH_KEPT_MS) return;
  prefetched.set(href, Date.now());
  // A full prefetch: this router's default when no kind is given.
  router.prefetch(href);
}

/** Renders nothing; registers the page it sits in. */
export function RenderStamp({ at, id }: RenderClock) {
  const router = useRouter();

  useEffect(() => {
    listen();
    refresh = () => router.refresh();
    const clock = { at, id };
    current = clock;
    document.documentElement.dataset.renderId = id;

    const firstShown = shown.get(id);
    const now = Date.now();
    stampedKey = location.pathname + location.search;
    stampedAt = now;
    if (firstShown === undefined) shown.set(id, now);

    // Shown before (and not just now by a second stamp in the same page):
    // this is the browser's kept copy.
    if (firstShown !== undefined && now - firstShown > 1_000) {
      void check(clock);
      return;
    }
    // Shown for the first time, but fetched on hover a while back.
    const asked = prefetched.get(location.pathname + location.search);
    if (firstShown === undefined && asked !== undefined && now - asked > FRESH_MS) {
      void check(clock);
    }
  }, [at, id, router]);

  return null;
}

/**
 * The safety net, mounted once in the app shell. A page that carries no stamp
 * cannot be checked, so if one is ever shown - a page added without a header,
 * an error screen - it is re-rendered rather than trusted. It runs after the
 * page's own stamp would have registered, in the same commit.
 */
export function FreshnessFallback() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const landedAt = Date.now();
    const timer = setTimeout(() => {
      const here = location.pathname + location.search;
      if (stampedKey !== here || stampedAt < landedAt - 1_000) router.refresh();
    }, 150);
    return () => clearTimeout(timer);
  }, [pathname, search, router]);

  return null;
}
