import Link from 'next/link';
import type { Paginated, Stage } from '@crm/shared';
import { StageChip, StalenessPill } from './stage';
import { Avatar, Card, EmptyState, LinkButton, Pill, cx } from './ui';
import { relativeDays } from '@/lib/format';

export interface ClientCaseSummary {
  id: string;
  reference: string;
  targetCountry: string;
  targetUniversity: string | null;
  targetProgram: string | null;
  intake: string | null;
  currentStage: Stage;
  /** The stage in the application's own workflow. */
  stageName?: string | null;
  stageSlaDays?: number | null;
  status: string;
  stageEnteredAt: string;
  lastActivityAt: string;
}

export interface ClientListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  city: string | null;
  archived: boolean;
  programme?: 'study_abroad' | 'course_only';
  hasLogin: boolean;
  createdAt: string;
  consultant: { id: string; name: string } | null;
  primaryCase: ClientCaseSummary | null;
  caseCount: number;
  pendingReviews: number;
  daysSinceActivity: number | null;
}

function daysInStage(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * The consultant's main working surface. Density is the point: a consultant
 * with 50 clients has to be able to see whose documents are waiting without
 * scrolling or clicking. One row per client, the review count on the right
 * where the eye lands last.
 *
 * On phones the same data becomes stacked cards - a horizontally scrolling
 * table is unusable one-handed.
 */
export function ClientTable({
  data,
  basePath,
  showConsultant = false,
  emptyAction,
}: {
  data: Paginated<ClientListItem>;
  basePath: string;
  showConsultant?: boolean;
  emptyAction?: React.ReactNode;
}) {
  if (data.items.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No clients match this view"
          description="Try clearing the search or filters. New clients you add will appear here straight away."
          action={emptyAction}
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* ---------- Desktop table ---------- */}
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="border-b border-line text-left">
            <Th className="pl-4">Client</Th>
            {showConsultant && <Th>Consultant</Th>}
            <Th>Stage</Th>
            <Th>Application</Th>
            <Th className="text-right">Waiting on you</Th>
            <Th className="text-right pr-4">Last activity</Th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((c) => (
            <tr
              key={c.id}
              className="group border-b border-line last:border-0 transition-colors hover:bg-ink-50"
            >
              <td className="py-3 pl-4 pr-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={c.fullName} size={34} />
                  <div className="min-w-0">
                    <Link
                      href={`${basePath}/${c.id}`}
                      className="block truncate text-[14px] font-medium text-ink-950 transition-colors hover:text-brand-700"
                    >
                      {c.fullName}
                      {/* Whole row is clickable via this stretched link. */}
                      <span className="absolute inset-0" aria-hidden style={{ position: 'static' }} />
                    </Link>
                    <p className="truncate text-[12px] text-ink-400">
                      {c.city ? `${c.city} · ` : ''}
                      {c.phone}
                    </p>
                  </div>
                  {c.programme === 'course_only' && (
                    <Pill tone="info" className="ml-1">
                      Course only
                    </Pill>
                  )}
                  {c.archived && (
                    <Pill tone="neutral" className="ml-1">
                      Archived
                    </Pill>
                  )}
                </div>
              </td>

              {showConsultant && (
                <td className="px-3 py-2.5">
                  <span className="truncate text-[13px] text-ink-600">
                    {c.consultant?.name ?? (
                      <span className="text-warn-700">Unassigned</span>
                    )}
                  </span>
                </td>
              )}

              <td className="px-3 py-2.5">
                {c.primaryCase ? (
                  <div className="flex flex-col items-start gap-1">
                    <StageChip
                      stage={c.primaryCase.currentStage}
                      country={c.primaryCase.targetCountry}
                      name={c.primaryCase.stageName}
                    />
                    <StalenessPill
                      stage={c.primaryCase.currentStage}
                      days={daysInStage(c.primaryCase.stageEnteredAt)}
                      slaDays={c.primaryCase.stageSlaDays}
                    />
                  </div>
                ) : (
                  <span className="text-[13px] text-ink-400">No application yet</span>
                )}
              </td>

              <td className="px-3 py-2.5">
                {c.primaryCase ? (
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink-800">
                      {c.primaryCase.targetCountry}
                    </p>
                    <p className="truncate text-[12px] text-ink-400">
                      {c.primaryCase.targetUniversity ?? 'University not chosen'}
                      {c.caseCount > 1 && (
                        <span className="ml-1 text-ink-500">+{c.caseCount - 1} more</span>
                      )}
                    </p>
                  </div>
                ) : (
                  <span className="text-[13px] text-ink-300">--</span>
                )}
              </td>

              <td className="px-3 py-2.5 text-right">
                {c.pendingReviews > 0 ? (
                  <Pill tone="warn" dot>
                    {c.pendingReviews} to review
                  </Pill>
                ) : (
                  <span className="text-[13px] text-ink-300">Clear</span>
                )}
              </td>

              <td className="py-2.5 pl-3 pr-4 text-right">
                <span className="text-[13px] text-ink-500">
                  {relativeDays(c.primaryCase?.lastActivityAt ?? null)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------- Mobile cards ---------- */}
      <ul className="divide-y divide-line md:hidden">
        {data.items.map((c) => (
          <li key={c.id}>
            <Link href={`${basePath}/${c.id}`} className="block px-4 py-3 active:bg-ink-50">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={c.fullName} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium text-ink-950">{c.fullName}</p>
                    <p className="truncate text-[12px] text-ink-400">
                      {c.primaryCase
                        ? `${c.primaryCase.targetCountry} · ${c.primaryCase.reference}`
                        : c.programme === 'course_only' ? 'Course only' : 'No application yet'}
                    </p>
                  </div>
                </div>
                {c.pendingReviews > 0 && (
                  <Pill tone="warn" dot>
                    {c.pendingReviews}
                  </Pill>
                )}
              </div>

              {c.primaryCase && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <StageChip
                    stage={c.primaryCase.currentStage}
                    country={c.primaryCase.targetCountry}
                    name={c.primaryCase.stageName}
                  />
                  <StalenessPill
                    stage={c.primaryCase.currentStage}
                    days={daysInStage(c.primaryCase.stageEnteredAt)}
                      slaDays={c.primaryCase.stageSlaDays}
                  />
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cx(
        'px-3 py-3 text-[12.5px] font-medium text-ink-500',
        className,
      )}
    >
      {children}
    </th>
  );
}

/** Page-through control. Shows the range, because "page 3" alone means nothing. */
export function Pagination({
  data,
  buildHref,
}: {
  data: Paginated<unknown>;
  buildHref: (page: number) => string;
}) {
  if (data.total === 0) return null;
  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.total, data.page * data.pageSize);

  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <p className="tnum text-[13px] text-ink-500">
        {from}-{to} of {data.total}
      </p>
      <div className="flex items-center gap-2">
        {data.page > 1 ? (
          <LinkButton href={buildHref(data.page - 1)} variant="secondary" size="sm">
            Previous
          </LinkButton>
        ) : (
          <span className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-[13px] text-ink-300">
            Previous
          </span>
        )}
        {data.page < data.totalPages ? (
          <LinkButton href={buildHref(data.page + 1)} variant="secondary" size="sm">
            Next
          </LinkButton>
        ) : (
          <span className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-[13px] text-ink-300">
            Next
          </span>
        )}
      </div>
    </div>
  );
}
