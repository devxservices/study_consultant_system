import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ROLE_HOME } from '@crm/shared';
import { getSession } from '@/lib/session';
import { getSite, siteName } from '@/lib/site';
import { AuthFrame } from '../sign-in/frame';
import { ForgotForm } from './forgot-form';

export const metadata = { title: 'Forgot password' };

export default async function ForgotPasswordPage() {
  const [user, site] = await Promise.all([getSession(), getSite()]);
  if (user) redirect(ROLE_HOME[user.role]);
  const closed = site.kind === 'tenant' && !site.available;

  return (
    <AuthFrame
      site={site}
      title="Forgot your password?"
      subtitle={`Enter the email you sign in to ${siteName(site)} with. We will send you a link to choose a new password.`}
    >
      {closed ? (
        <p className="rounded-lg bg-warn-50 px-4 py-3.5 text-[13.5px] text-warn-700 ring-1 ring-warn-200">
          This portal is currently unavailable.
        </p>
      ) : (
        <ForgotForm />
      )}
      <p className="mt-6 text-center text-[13px]">
        <Link href="/sign-in" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
