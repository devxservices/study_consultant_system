'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { buttonClass } from './ui';
import { IconAlert } from './icons';

/**
 * What a screen shows when its data could not be loaded - the API was
 * restarting, the network dropped, a request was refused. It renders inside
 * the portal's own chrome, so the rail and everything else keep working, and
 * "Try again" re-runs the page on the server rather than only re-rendering
 * what failed. In production the cause is not shown (server errors are
 * redacted); the reference is what an administrator needs to find it.
 */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [retrying, startRetry] = useTransition();
  const home = `/${pathname.split('/')[1] ?? ''}`;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[55vh] items-center justify-center py-10">
      <div className="w-full max-w-md rounded-xl bg-paper p-8 text-center shadow-card">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-bad-50 text-bad-600 ring-8 ring-bad-50/50">
          <IconAlert size={22} />
        </span>
        <h1 className="mt-5 text-[18px] font-medium text-ink-950">This page could not load</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">
          Something interrupted it on our side. It is usually brief - try again in a moment. If it keeps
          happening, let your administrator know
          {error.digest ? (
            <>
              {' '}and quote <code className="rounded bg-ink-100 px-1 py-0.5 text-[12px] text-ink-700">{error.digest}</code>
            </>
          ) : null}
          .
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={retrying}
            onClick={() =>
              startRetry(() => {
                router.refresh();
                reset();
              })
            }
            className={buttonClass('primary')}
          >
            {retrying && (
              <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
            )}
            {retrying ? 'Trying again…' : 'Try again'}
          </button>
          <Link href={home} className={buttonClass('secondary')}>
            Go to the start
          </Link>
        </div>
      </div>
    </div>
  );
}
