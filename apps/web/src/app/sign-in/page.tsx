import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ROLE_HOME } from '@crm/shared';
import { getSession } from '@/lib/session';
import { getSite, siteBranding, siteName, type Site } from '@/lib/site';
import { SignInForm } from './sign-in-form';
import { LegalLinks } from '@/components/legal-document';
import { AuthFrame } from './frame';

export const metadata = { title: 'Sign in' };

/**
 * Which front door depends on the address: a consultancy's own portal carries
 * its name and logo and signs in only its people; the admin address signs in
 * only platform admins.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; done?: string }>;
}) {
  const [user, site, sp] = await Promise.all([getSession(), getSite(), searchParams]);
  if (user) redirect(ROLE_HOME[user.role]);

  const name = siteName(site);
  const branding = siteBranding(site);
  const isPlatform = site.kind === 'platform';
  const closed = site.kind === 'tenant' && !site.available;

  return (
    <AuthFrame
      site={site}
      title={isPlatform ? 'Platform administration' : `Sign in to ${name}`}
      subtitle={
        isPlatform
          ? 'Manage consultancies, their domains and their branding.'
          : 'Students, staff and partners all sign in here.'
      }
      // Local-only helper: production never shows it.
      footer={process.env.NODE_ENV !== 'production' ? <DemoAccounts site={site} /> : undefined}
    >
      {closed ? (
        <div
          role="status"
          className="rounded-lg bg-warn-50 px-4 py-3.5 text-[13.5px] leading-relaxed text-warn-700 ring-1 ring-warn-200"
        >
          This portal is currently unavailable. Your records are safe - please contact {name} directly
          {branding?.contactPhone ? (
            <>
              {' '}
              on <span className="font-medium">{branding.contactPhone}</span>
            </>
          ) : null}
          .
        </div>
      ) : (
        <>
          {sp.done === 'password' && (
            <div
              role="status"
              className="mb-4 rounded-lg bg-ok-50 px-3.5 py-2.5 text-[13px] text-ok-700 ring-1 ring-ok-200"
            >
              Your password is set. Sign in with it now.
            </div>
          )}
          <SignInForm initialEmail={typeof sp.email === 'string' ? sp.email.slice(0, 254) : ''} />
          <p className="mt-4 text-center text-[13px]">
            <Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">
              Forgot your password?
            </Link>
          </p>
        </>
      )}

      {!isPlatform && !closed && (
        <p className="mt-8 text-center text-[13px] text-ink-400">
          Still stuck?{' '}
          {branding?.contactEmail ? (
            <>
              Email{' '}
              <a href={`mailto:${branding.contactEmail}`} className="font-medium text-brand-700 hover:underline">
                {branding.contactEmail}
              </a>
              {branding.contactPhone ? <> or call {branding.contactPhone}</> : null}.
            </>
          ) : branding?.contactPhone ? (
            <>Call {branding.contactPhone}.</>
          ) : (
            'Contact your consultant.'
          )}
        </p>
      )}
      <LegalLinks className="mt-4 text-center text-[12.5px] text-ink-400" />
    </AuthFrame>
  );
}

function DemoAccounts({ site }: { site: Site }) {
  const accounts: [string, string][] =
    site.kind === 'platform'
      ? [['admin@platform.test', 'platform admin']]
      : site.kind === 'tenant' && site.tenant.slug === 'futurepath'
        ? [
            ['manager@futurepath.pk', 'manager'],
            ['sana@futurepath.pk', 'consultant'],
          ]
        : [
            ['manager@consultancy.pk', 'manager'],
            ['ayesha@consultancy.pk', 'consultant'],
          ];

  return (
    <footer className="border-t border-line bg-ink-50 px-5 py-4">
      <div className="mx-auto max-w-[380px]">
        <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-400">
          Demo accounts
        </p>
        <ul className="space-y-1 text-[12px] text-ink-500">
          {accounts.map(([email, role]) => (
            <li key={email}>
              <code className="text-ink-700">{email}</code> &mdash; {role}
            </li>
          ))}
          {site.kind !== 'platform' && <li>Any seeded client email of this consultancy</li>}
          <li>
            Password <code className="text-ink-700">password123</code>
          </li>
        </ul>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
          Other sites: <code className="text-ink-600">localhost:3000</code>,{' '}
          <code className="text-ink-600">futurepath.localhost:3000</code>,{' '}
          <code className="text-ink-600">admin.localhost:3000</code>
        </p>
      </div>
    </footer>
  );
}
