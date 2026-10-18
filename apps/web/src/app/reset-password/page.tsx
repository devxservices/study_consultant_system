import Link from 'next/link';
import type { PasswordLinkInfo } from '@crm/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { getSite, siteName } from '@/lib/site';
import { AuthFrame } from '../sign-in/frame';
import { ResetForm } from './reset-form';

export const metadata = { title: 'Choose your password' };

/**
 * Where reset and invitation emails lead. The link is checked before the
 * form is shown, so nobody types a new password into a link that is spent.
 * Someone already signed in still sees the form: the link is for this
 * person's account, whoever is signed in on this browser.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [site, sp] = await Promise.all([getSite(), searchParams]);
  const token = typeof sp.token === 'string' ? sp.token : '';

  let info: PasswordLinkInfo | null = null;
  let problem: string | null = null;
  if (!token) {
    problem = 'This page needs the link from your email. Open the email and tap the link again.';
  } else {
    try {
      info = await apiFetch<PasswordLinkInfo>(`/auth/password/link?token=${encodeURIComponent(token)}`);
    } catch (err) {
      problem = err instanceof ApiError ? err.message : 'We could not check this link. Please try again in a moment.';
    }
  }

  const name = siteName(site);
  return (
    <AuthFrame
      site={site}
      title={info ? (info.purpose === 'invite' ? `Welcome, ${info.firstName}` : `New password, ${info.firstName}`) : 'Choose your password'}
      subtitle={
        info
          ? info.purpose === 'invite'
            ? `Choose a password for your ${name} account. You will sign in with ${info.email}.`
            : `Choose a new password for ${info.email}.`
          : 'Set the password you will sign in with.'
      }
    >
      {info ? (
        <ResetForm token={token} email={info.email} />
      ) : (
        <div className="space-y-4">
          <p role="alert" className="rounded-lg bg-warn-50 px-4 py-3.5 text-[13.5px] leading-relaxed text-warn-700 ring-1 ring-warn-200">
            {problem}
          </p>
          <Link
            href="/forgot-password"
            className="press flex h-11 w-full items-center justify-center rounded-lg border border-line-strong bg-paper text-[15px] font-medium text-ink-800 hover:bg-ink-50"
          >
            Send me a new link
          </Link>
        </div>
      )}
      <p className="mt-6 text-center text-[13px]">
        <Link href="/sign-in" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
