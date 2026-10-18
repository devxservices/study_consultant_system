import type { ReactNode } from 'react';
import { STAGE_DEFINITIONS } from '@crm/shared';
import { siteBranding, siteName, type Site } from '@/lib/site';
import { BrandMark } from '@/components/brand-mark';
import { IconCheck, IconShield, IconChat, IconGlobe, IconUsers } from '@/components/icons';

/**
 * The front door's frame, shared by signing in, asking for a reset link and
 * choosing a password: two panes on a wide screen, one on a phone.
 *
 * The dark pane is the same plane as the app's navigation rail, so signing in
 * looks like the front door of the thing you are about to be inside. It is
 * decoration in the strict sense - it carries no controls - so it is the half
 * that disappears below `lg` rather than the form.
 */
export function AuthFrame({
  site,
  title,
  subtitle,
  children,
  footer,
}: {
  site: Site;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const name = siteName(site);
  const branding = siteBranding(site);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      <Showcase site={site} />

      <div className="flex min-h-dvh flex-col bg-paper lg:min-h-0">
        <main className="flex flex-1 items-center justify-center px-5 py-10">
          <div className="page-enter w-full max-w-[380px]">
            <div className="mb-7">
              <BrandMark name={name} branding={branding} size={46} className="mb-6" />
              <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink-950">{title}</h1>
              <p className="mt-1.5 text-[14px] text-ink-500">{subtitle}</p>
            </div>
            {children}
          </div>
        </main>
        {footer}
      </div>
    </div>
  );
}

function Showcase({ site }: { site: Site }) {
  const name = siteName(site);
  const branding = siteBranding(site);

  const points =
    site.kind === 'platform'
      ? [
          {
            icon: <IconUsers size={17} />,
            title: 'Every consultancy, one platform',
            body: 'Onboard a consultancy with its first manager in one step. Its data never meets anyone else’s.',
          },
          {
            icon: <IconGlobe size={17} />,
            title: 'Their domain, their brand',
            body: 'Each consultancy is served on its own address, in its own colours, with its own logo.',
          },
          {
            icon: <IconShield size={17} />,
            title: 'Suspend without losing anything',
            body: 'Taking a consultancy offline locks everyone out at once and deletes nothing.',
          },
        ]
      : [
          {
            icon: <IconCheck size={17} />,
            title: 'One place, not five',
            body: 'Your case, your documents and your consultant, instead of a WhatsApp thread and a folder of scans.',
          },
          {
            icon: <IconShield size={17} />,
            title: 'Nothing gets lost',
            body: 'Every upload, review and stage change is recorded with who did it and when.',
          },
          {
            icon: <IconChat size={17} />,
            title: 'Ask, and get an answer',
            body: 'Message your consultant on the case itself, so nobody has to ask which application you mean.',
          },
        ];

  // Real step names from the pipeline, as an illustration of the product -
  // no figures, so nothing here can be mistaken for anyone's data.
  const steps = (['documents_collection', 'application_submitted', 'offer_letter', 'visa_filed'] as const).map(
    (k) => STAGE_DEFINITIONS[k].clientLabel,
  );

  return (
    <aside className="relative hidden overflow-hidden bg-rail-950 p-12 lg:flex lg:flex-col lg:justify-center">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand-600)_45%,transparent),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-32 size-[560px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-series-2)_22%,transparent),transparent)]"
      />
      <div className="relative mx-auto w-full max-w-[440px]">
        <div className="mb-10 flex items-center gap-3">
          <BrandMark name={name} branding={branding} size={36} />
          <span className="text-[16px] font-medium text-rail-ink">{name}</span>
        </div>

        <h2 className="text-[32px] font-medium leading-[1.2] tracking-[-0.02em] text-rail-ink">
          {site.kind === 'platform'
            ? 'Run every consultancy on the platform from one place.'
            : 'Every study visa application, from first call to decision.'}
        </h2>

        <ul className="mt-9 space-y-6">
          {points.map((p) => (
            <li key={p.title} className="flex gap-3.5">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-rail-ink ring-1 ring-white/10">
                {p.icon}
              </span>
              <div>
                <p className="text-[14.5px] font-medium text-rail-ink">{p.title}</p>
                <p className="mt-0.5 text-[13.5px] leading-relaxed text-rail-muted">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>

        {site.kind !== 'platform' && steps.length > 0 && (
          <div
            aria-hidden
            className="float mt-12 w-[300px] rounded-2xl bg-white/[0.06] p-4 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.6)] ring-1 ring-white/10 backdrop-blur-md"
          >
            <p className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-rail-dim">Your application</p>
            <ol className="mt-3 space-y-2.5">
              {steps.map((label, i) => (
                <li key={label} className="flex items-center gap-2.5 text-[13px]">
                  {i < 2 ? (
                    <span className="flex size-5 items-center justify-center rounded-full bg-ok-500 text-white">
                      <IconCheck size={12} strokeWidth={2.5} />
                    </span>
                  ) : i === 2 ? (
                    <span className="flex size-5 items-center justify-center rounded-full ring-2 ring-brand-400">
                      <span className="size-2 rounded-full bg-brand-400" />
                    </span>
                  ) : (
                    <span className="size-5 rounded-full ring-2 ring-white/15" />
                  )}
                  <span className={i <= 2 ? 'text-rail-ink' : 'text-rail-dim'}>{label}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </aside>
  );
}
