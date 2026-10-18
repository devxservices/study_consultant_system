import { redirect } from 'next/navigation';
import { ROLE_HOME } from '@crm/shared';
import { getSession } from '@/lib/session';
import { getSite, siteBranding, siteName } from '@/lib/site';
import { BrandMark } from '@/components/brand-mark';
import { SignOutButton } from '@/components/sign-out';
import { TwoStepSetup } from '@/components/two-step';
import { IconShield } from '@/components/icons';

export const metadata = { title: 'Set up two-step verification' };

/**
 * Where someone lands when their consultancy requires two-step verification
 * and they have not set it up. The API refuses them everything else until
 * they have, so this page is the only way forward - or out.
 */
export default async function SecuritySetupPage() {
  const [user, site] = await Promise.all([getSession(), getSite()]);
  if (!user) redirect('/sign-in');
  if (!user.mfaSetupRequired) redirect(ROLE_HOME[user.role]);

  const name = siteName(site);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[640px]">
        <div className="mb-5 flex items-center gap-2.5">
          <BrandMark name={name} branding={siteBranding(site)} size={34} />
          <span className="text-[15px] font-semibold text-ink-950">{name}</span>
        </div>

        <div className="rounded-2xl bg-paper p-5 shadow-card sm:p-7">
          <div className="mb-5 flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-info-50 text-info-600">
              <IconShield size={21} />
            </span>
            <div>
              <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink-950">
                Protect your account to continue
              </h1>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-500">
                {name} requires two-step verification. It takes about a minute: after your password, you will also
                type a code from an app on your phone - so a stolen password alone is never enough to get in.
              </p>
            </div>
          </div>
          <TwoStepSetup doneHref={ROLE_HOME[user.role]} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-ink-500">
          <span>
            Signed in as <span className="font-medium text-ink-800">{user.email}</span>
          </span>
          <span className="w-auto">
            <SignOutButton />
          </span>
        </div>
      </div>
    </div>
  );
}
