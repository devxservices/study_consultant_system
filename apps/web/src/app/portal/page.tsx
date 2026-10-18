import { PageStamp } from '@/components/page-stamp';
import Link from 'next/link';
import {
  OFFER_TYPE_LABEL,
  STAGE_DEFINITIONS,
  formatMoney,
  type AnnouncementView,
  type BillingTotals,
  type StudentChecklistView,
} from '@crm/shared';
import { enabledModules } from '@/lib/entitlements';
import { AnnouncementFeed } from '@/components/announcements';
import { Card, EmptyState, IconTile, Panel, Pill, StatCard, cx } from '@/components/ui';
import { RingMeter } from '@/components/charts/ring-meter';
import { IconCalendar, IconWallet } from '@/components/icons';
import { IconChat, IconChevronRight, IconFile, IconChart, IconCheck } from '@/components/icons';
import { formatDate, todayIso } from '@/lib/format';
import { apiFetch } from '@/lib/api';
import { currentStep, getPortalClient, getPortalCase } from '@/lib/portal';

export const metadata = { title: 'My application' };

/**
 * The dashboard home. The five-second answer to "where is my application?"
 * stays above the fold, and everything else is a tile that hands off to the
 * tab that owns it - documents, progress, messages.
 */
export default async function PortalOverviewPage() {
  const { user, client, firstCase } = await getPortalClient();

  if (!client) {
    return (
      <Card>
        <EmptyState
          title="Your file is being set up"
          description="Your consultant has not finished setting up your record yet. Please check back shortly."
        />
      </Card>
    );
  }
  if (!firstCase) {
    const courseOnly = (client as { programme?: string }).programme === 'course_only';
    return (
      <Card>
        <EmptyState
          title={courseOnly ? 'Your course' : 'No application open yet'}
          description={
            courseOnly
              ? 'Your timetable, homework, mock scores and certificate are on your courses page. If you decide to study abroad, tell us and a consultant will take it from there.'
              : 'Your consultant will open your application once your first consultation is done.'
          }
          action={
            courseOnly ? (
              <Link href="/portal/courses" className="font-medium text-brand-700 hover:underline">
                Go to my courses
              </Link>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const modules = await enabledModules();
  const [detail, unread, money, notices, checklist] = await Promise.all([
    getPortalCase(firstCase.id),
    apiFetch<{ total: number }>('/messages/unread')
      .then((r) => r.total)
      .catch(() => 0),
    modules.has('billing') ? apiFetch<BillingTotals[]>('/billing/totals').catch(() => []) : Promise.resolve(null),
    modules.has('announcements') ? apiFetch<AnnouncementView[]>('/announcements').catch(() => []) : Promise.resolve([] as AnnouncementView[]),
    apiFetch<StudentChecklistView>('/drive/checklist').catch(() => null),
  ]);
  const owed = money?.[0];
  const dates = [
    { label: 'Application deadline', date: detail.applicationDeadline },
    { label: 'Accept your offer by', date: detail.offerDeadline },
    { label: 'Visa appointment', date: detail.visaAppointmentAt },
    { label: 'Travel date', date: detail.travelDate },
  ]
    // A calendar list: what is still ahead. Passed dates stay on the Progress page.
    .filter((d): d is { label: string; date: string } => Boolean(d.date) && d.date!.slice(0, 10) >= todayIso());

  const def = currentStep(detail);
  const isDone = detail.currentStage === 'closed';
  // The same checklist the Documents page shows, across every application,
  // so the two pages always give the same answer.
  const apps = checklist?.applications ?? [];
  const docRequired = checklist ? apps.reduce((n, a) => n + a.required, 0) : detail.progress.required;
  const docApproved = checklist ? apps.reduce((n, a) => n + a.approved, 0) : detail.progress.verified;
  const toDo = checklist
    ? apps.reduce(
        (n, a) =>
          n + a.items.filter((i) => i.required && (i.status === 'missing' || i.status === 'rejected' || i.status === 'reupload_requested' || i.expired)).length,
        0,
      )
    : detail.progress.items.filter((i) => i.status === 'missing' || i.status === 'rejected').length;
  const allApproved = docRequired > 0 && docApproved >= docRequired;
  const pct = docRequired === 0 ? (isDone ? 100 : 0) : Math.round((docApproved / docRequired) * 100);

  return (
    <div className="space-y-5">
      <PageStamp />
      <div>
        <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink-950">
          Hello, {user.fullName.split(' ')[0]}
        </h1>
        <p className="mt-0.5 text-[14px] text-ink-500">Here is where your application stands.</p>
      </div>

      {/* The five-second answer, on the consultancy's own colour. The card
          darkens toward one corner with an overlay rather than a darker brand
          step: in dark mode the high steps are light, and the white type on
          this card has to stay readable whatever colour a consultancy picks. */}
      {isDone ? (
        <section className="rounded-2xl bg-ok-50 p-6 shadow-card ring-1 ring-ok-200">
          <p className="text-[13px] text-ok-700">Your application is at</p>
          <h2 className="mt-1 text-[26px] font-medium leading-8 tracking-[-0.02em] text-ok-700">
            {def.clientLabel}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-ok-700/90">{def.clientDescription}</p>
        </section>
      ) : (
        <section className="relative overflow-hidden rounded-2xl bg-brand-600 p-6 text-white shadow-raise sm:p-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_35%,rgb(0_0_0/0.28))]"
          />
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/[0.07]" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 right-24 size-56 rounded-full bg-white/[0.05]" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-white/75">Your application is at</p>
              <h2 className="mt-1 text-[26px] font-medium leading-8 tracking-[-0.02em]">{def.clientLabel}</h2>
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/85">{def.clientDescription}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/15 px-3 py-1 text-[12.5px] font-medium">
                  {detail.targetUniversity ?? detail.targetCountry}
                </span>
                {detail.intake && (
                  <span className="rounded-full bg-white/15 px-3 py-1 text-[12.5px] font-medium">{detail.intake}</span>
                )}
                <span className="text-[12.5px] text-white/70">Since {formatDate(detail.stageEnteredAt)}</span>
              </div>
            </div>
            {docRequired > 0 && (
              <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:gap-2">
                <RingMeter value={pct} inverse size={116} stroke={10} label="Documents approved" caption="approved" />
                <p className="text-[12.5px] text-white/80">
                  {docApproved} of {docRequired} documents
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* At a glance. */}
      <div className={cx('grid gap-4 sm:grid-cols-2', owed ? 'xl:grid-cols-4' : 'xl:grid-cols-3')}>
        <StatCard
          label={docRequired ? 'Documents approved' : 'Documents'}
          value={docRequired ? `${docApproved}/${docRequired}` : 'All set'}
          hint={docRequired ? `${pct}% of what we need${apps.length > 1 ? ', all applications' : ''}` : 'nothing needed yet'}
          tone={allApproved || !docRequired ? 'ok' : 'neutral'}
          href="/portal/documents"
          icon={<IconCheck size={20} />}
        />
        <StatCard
          label="To send"
          value={toDo}
          hint={toDo === 0 ? 'nothing outstanding' : 'need your attention'}
          tone={toDo > 0 ? 'warn' : 'ok'}
          icon={<IconFile size={20} />}
          href="/portal/documents"
        />
        <StatCard
          label="Messages"
          value={unread}
          hint={unread === 0 ? 'no new replies' : 'unread from your consultant'}
          tone={unread > 0 ? 'info' : 'neutral'}
          icon={<IconChat size={20} />}
          href="/portal/messages"
        />
        {owed && (
          <StatCard
            label="Fees due"
            value={formatMoney(owed.outstanding, owed.currency)}
            hint={owed.outstanding === 0 ? 'all paid up' : owed.overdue ? 'some of it is overdue' : 'see your invoices'}
            tone={owed.overdue ? 'warn' : owed.outstanding ? 'info' : 'ok'}
            icon={<IconWallet size={20} />}
            href="/portal/payments"
          />
        )}
      </div>

      {/* The single next step, stated plainly. */}
      <NextStep toDo={toDo} satisfied={allApproved} isDone={isDone} owed={owed ? { outstanding: owed.outstanding, overdue: owed.overdue } : null} />

      {(dates.length > 0 || detail.offerType || notices.length > 0) && (
        <div
          className={cx(
            'grid items-start gap-5',
            (dates.length > 0 || detail.offerType) && notices.length > 0 && 'xl:grid-cols-2',
          )}
        >
          {(dates.length > 0 || detail.offerType) && (
            <Panel title="Important dates" subtitle="Put these in your calendar">
              {detail.offerType && (
                <div className="mb-4 rounded-lg bg-ink-50 p-3">
                  <Pill tone={detail.offerType === 'unconditional' ? 'ok' : 'warn'} dot>
                    {OFFER_TYPE_LABEL[detail.offerType]}
                  </Pill>
                  {detail.offerConditions && (
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
                      Still to show the university: {detail.offerConditions}
                    </p>
                  )}
                </div>
              )}
              <ul className="space-y-3">
                {dates.map((d) => (
                  <li key={d.label} className="flex items-center gap-3">
                    <IconTile tone="info" size={38}>
                      <IconCalendar size={18} />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-ink-900">{d.label}</p>
                      <p className="text-[12.5px] text-ink-500">
                        {new Date(d.date.length === 10 ? `${d.date}T00:00:00` : d.date).toLocaleDateString('en-GB', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          ...(d.date.length > 10 ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}),
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {notices.length > 0 && (
            <Panel title="From your consultancy" bodyClassName="">
              <AnnouncementFeed items={notices.slice(0, 3)} compact />
            </Panel>
          )}
        </div>
      )}

      {client.cases.length > 1 && (
        <Panel title="Your applications" subtitle="Each one moves through the steps on its own">
          <ul className="divide-y divide-line">
            {client.cases.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[13.5px] font-medium text-ink-900">{k.targetCountry}</span>
                {/* The student wording of the stage, as on the card above - never the staff name. */}
                <Pill tone="neutral">{STAGE_DEFINITIONS[k.currentStage].clientLabel}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Jump-off tiles to the tabs that hold the detail. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <TabLink
          href="/portal/progress"
          icon={<IconChart size={20} />}
          title="Your progress"
          desc="Every step of your application, and where you are now."
        />
        <TabLink
          href="/portal/documents"
          icon={<IconFile size={20} />}
          title="Documents"
          desc="See what is approved and upload what is still needed."
        />
        <TabLink
          href="/portal/messages"
          icon={<IconChat size={20} />}
          title="Messages"
          desc={
            client.consultant
              ? `Chat with ${client.consultant.name.split(' ')[0]}, your consultant.`
              : 'Chat with your consultant once assigned.'
          }
        />
      </div>
    </div>
  );
}

function NextStep({
  toDo,
  satisfied,
  isDone,
  owed,
}: {
  toDo: number;
  satisfied: boolean;
  isDone: boolean;
  /** Fees, when the consultancy bills through the portal. */
  owed: { outstanding: number; overdue: number } | null;
}) {
  const feesLeft = Boolean(owed && owed.outstanding > 0);
  if (toDo === 0 && owed && owed.overdue > 0) {
    return (
      <Link href="/portal/payments" className="lift flex items-center gap-3 rounded-xl bg-warn-50 p-4 ring-1 ring-warn-200">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warn-100 text-warn-700">
          <IconWallet size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink-900">A payment is overdue</p>
          <p className="text-[13px] text-ink-500">Open Payments to pay online or send proof of a payment you made.</p>
        </div>
        <IconChevronRight size={18} className="shrink-0 text-ink-400" />
      </Link>
    );
  }
  if (isDone) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-ok-50 p-4 ring-1 ring-ok-200">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ok-100 text-ok-700">
          <IconCheck size={18} />
        </span>
        <p className="text-[14px] text-ok-700">
          {feesLeft
            ? 'Your application is complete. The only thing left is the fee shown under Payments.'
            : 'Your application is complete. There is nothing left for you to do.'}
        </p>
      </div>
    );
  }
  if (toDo > 0) {
    return (
      <Link
        href="/portal/documents"
        className="lift flex items-center gap-3 rounded-xl bg-warn-50 p-4 ring-1 ring-warn-200"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warn-100 text-warn-700">
          <IconFile size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink-900">
            {toDo} document{toDo === 1 ? '' : 's'} need{toDo === 1 ? 's' : ''} your attention
          </p>
          <p className="text-[13px] text-ink-500">Open Documents to send what is still required.</p>
        </div>
        <IconChevronRight size={18} className="shrink-0 text-ink-400" />
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-xl bg-paper p-4 shadow-card">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ok-50 text-ok-700">
        <IconCheck size={18} />
      </span>
      <p className="text-[14px] text-ink-600">
        {satisfied
          ? 'Everything we need from you is in. Your consultant is moving your case forward.'
          : 'No documents are needed from you right now. Your consultant will let you know the next step.'}
        {feesLeft && ' Your next payment and its date are under Payments.'}
      </p>
    </div>
  );
}

function TabLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="lift group flex flex-col rounded-xl bg-paper p-5 shadow-card"
    >
      <span className="flex size-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700 transition-transform duration-300 group-hover:scale-105">
        {icon}
      </span>
      <p className="mt-3.5 flex items-center gap-1 text-[15px] font-medium text-ink-950">
        {title}
        <IconChevronRight
          size={16}
          className="text-ink-300 transition-transform group-hover:translate-x-0.5"
        />
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-500">{desc}</p>
    </Link>
  );
}
