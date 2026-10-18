import Link from 'next/link';
import { MODULE_LABEL, MODULES, ROLE_HOME, type Module } from '@crm/shared';
import { getSession } from '@/lib/session';
import { getSite, siteBranding, siteName } from '@/lib/site';
import { BrandMark } from '@/components/brand-mark';

export const metadata = { title: 'Not in your plan' };

/**
 * Where a page lands when it needs a feature the consultancy's plan does not
 * include - usually an old link or a bookmark, since menus already hide them.
 */
export default async function PlanRequiredPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const [user, site, sp] = await Promise.all([getSession(), getSite(), searchParams]);
  const mod = (MODULES as readonly string[]).includes(sp.module ?? '') ? (sp.module as Module) : null;
  const feature = mod ? MODULE_LABEL[mod] : 'This feature';
  const home = user ? ROLE_HOME[user.role] : '/sign-in';
  const isManager = user?.role === 'manager';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-10">
      <div className="page-enter w-full max-w-[440px] rounded-2xl bg-paper p-7 text-center shadow-card">
        <BrandMark name={siteName(site)} branding={siteBranding(site)} size={44} className="mx-auto mb-5" />
        <h1 className="text-[20px] font-medium text-ink-950">{feature} is not part of your plan</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-500">
          {isManager
            ? 'Your consultancy’s plan does not include it, so it is switched off. Ask your platform provider to add it to your plan - nothing you have recorded is lost.'
            : 'Your consultancy has not switched this on. If you need it, ask your manager.'}
        </p>
        <Link
          href={home}
          className="press mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-5 text-[14px] font-medium text-white hover:brightness-[0.93]"
        >
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
