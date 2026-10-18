import Link from 'next/link';
import type { BrandingSettings } from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { getEntitlements } from '@/lib/entitlements';
import { Card, cx } from './ui';
import { IconCheck, IconChevronRight } from './icons';

/**
 * The first steps for a consultancy that has just joined, on its manager's
 * overview - instead of a dashboard of zeros with nothing to say what next.
 * Each step ticks itself off from the data; the card goes once the
 * consultancy is branded and has its first client.
 */
export async function GettingStarted() {
  const [entitlements, branding] = await Promise.all([
    getEntitlements(),
    apiFetch<BrandingSettings>('/tenancy/branding').catch(() => null),
  ]);
  if (!entitlements || !branding) return null;

  const branded = Boolean(branding.logoUrl && branding.contactEmail);
  const hasClient = entitlements.usage.activeClients > 0;
  if (branded && hasClient) return null;

  const steps = [
    {
      done: branded,
      title: 'Add your logo and contact details',
      detail: 'They appear on the sign-in page, every screen and every email your students get.',
      href: '/overview/branding',
    },
    {
      done: entitlements.usage.staff > 1,
      title: 'Invite your team',
      detail: 'Counsellors, an accountant, a trainer - each gets an email to choose their password.',
      href: '/overview/consultants/new',
    },
    {
      done: false,
      title: 'Check your countries and their steps',
      detail: 'Intakes, fees and the documents each destination needs drive every student’s checklist.',
      href: '/overview/countries',
    },
    {
      done: hasClient,
      title: 'Add your first student',
      detail: 'Open their application, then invite them to the portal to upload documents and message you.',
      href: '/overview/clients/new',
    },
  ];
  const left = steps.filter((s) => !s.done).length;

  return (
    <Card className="mb-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-medium text-ink-950">Getting started</h2>
        <p className="text-[12.5px] text-ink-400">
          {left} of {steps.length} to do
        </p>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className={cx(
                'group flex h-full items-start gap-3 rounded-lg px-3 py-2.5 ring-1 transition-colors',
                s.done ? 'bg-ok-50 ring-ok-200' : 'bg-paper ring-line hover:bg-ink-50',
              )}
            >
              <span
                className={cx(
                  'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                  s.done ? 'bg-ok-600 text-white' : 'bg-ink-100 text-ink-600',
                )}
                aria-hidden
              >
                {s.done ? <IconCheck size={13} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx('block text-[13.5px] font-medium', s.done ? 'text-ok-700' : 'text-ink-950')}>
                  {s.title}
                  {s.done && <span className="sr-only"> (done)</span>}
                </span>
                <span className="block text-[12.5px] text-ink-500">{s.detail}</span>
              </span>
              {!s.done && <IconChevronRight size={15} className="mt-1 shrink-0 text-ink-300 group-hover:text-ink-500" />}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
