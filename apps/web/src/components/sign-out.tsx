'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cx } from './ui';
import { IconLogout } from './icons';

export function SignOutButton({ rail = false }: { rail?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch('/api/auth/sign-out', { method: 'POST' });
    router.replace('/sign-in');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      title="Sign out"
      className={cx(
        'press flex w-full items-center gap-3 rounded-lg text-left disabled:opacity-60',
        rail
          ? 'h-10 px-3 text-[14px] text-rail-muted hover:bg-white/[0.05] hover:text-rail-ink group-data-[collapsed=true]/shell:justify-center group-data-[collapsed=true]/shell:px-0'
          : 'h-9 px-2.5 text-[13.5px] text-ink-700 hover:bg-bad-50 hover:text-bad-700',
      )}
    >
      {busy ? (
        <span
          aria-hidden
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : (
        <IconLogout size={rail ? 19 : 16} className={cx('shrink-0', !rail && 'text-ink-400')} />
      )}
      <span className={cx(rail && 'group-data-[collapsed=true]/shell:hidden')}>
        {busy ? 'Signing out…' : 'Sign out'}
      </span>
    </button>
  );
}
