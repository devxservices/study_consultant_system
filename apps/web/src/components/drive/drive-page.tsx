import Link from 'next/link';
import {
  type DocumentTypeView,
  type DriveListing,
  type DriveSettingsView,
  type DriveStudentView,
  type Paginated,
  type StudentChecklistView,
  type AuthUser,
} from '@crm/shared';
import { apiFetch, qs } from '@/lib/api';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/format';
import { Card, EmptyState, PageHeader, cx } from '../ui';
import { Pagination } from '../client-table';
import { IconChevronRight, IconClock, IconFile, IconFolder, IconInbox, IconShare, IconStar, IconTrash, IconUsers, IconBuilding, IconKey } from '../icons';
import { DriveItems } from './drive-items';
import { DriveToolbar } from './drive-toolbar';
import { DriveActions } from './drive-actions';
import { ChecklistPanel } from './checklist-panel';

const VIEWS = [
  { key: 'all', label: 'All documents', icon: IconFile },
  { key: 'review', label: 'To review', icon: IconInbox },
  { key: 'expiring', label: 'Expiring', icon: IconClock },
  { key: 'starred', label: 'Starred', icon: IconStar },
  { key: 'recent', label: 'Recent', icon: IconClock },
  { key: 'shared', label: 'Shared outside', icon: IconShare },
  { key: 'trash', label: 'Trash', icon: IconTrash },
] as const;

const PASS = ['folderId', 'clientId', 'area', 'view', 'q', 'type', 'status', 'country', 'uploaderRole', 'tag', 'from', 'to', 'sort', 'page'] as const;

/**
 * The documents drive for staff - the same screen for managers and
 * consultants, scoped by the API to what each may see.
 */
export async function DrivePage({
  user,
  basePath,
  searchParams,
}: {
  user: AuthUser;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const sp = searchParams;
  const layout = sp.layout === 'grid' ? 'grid' : 'list';
  const students = sp.area === 'students';
  const query = Object.fromEntries(PASS.map((k) => [k, sp[k]]).filter(([, v]) => v)) as Record<string, string>;
  if (!query.folderId && !query.clientId && !query.area && !query.view) query.view = 'all';

  const [listing, studentList, types, settings, checklist] = await Promise.all([
    students ? Promise.resolve(null) : apiFetch<DriveListing>(`/drive${qs({ ...query, pageSize: 50 })}`),
    students ? apiFetch<Paginated<DriveStudentView>>(`/drive/students${qs({ q: sp.q, page: sp.page, pageSize: 50 })}`) : Promise.resolve(null),
    apiFetch<DocumentTypeView[]>('/drive/types'),
    apiFetch<DriveSettingsView>('/drive/settings'),
    sp.clientId && !sp.folderId ? apiFetch<StudentChecklistView>(`/drive/students/${sp.clientId}/checklist`).catch(() => null) : Promise.resolve(null),
  ]);

  const abilities = {
    manage: can(user, 'document.manage'),
    share: can(user, 'document.share'),
    review: can(user, 'document.verify'),
    manager: user.role === 'manager',
    trash: can(user, 'document.delete'),
  };
  const folder = listing?.folder ?? null;
  const studentId = folder?.clientId ?? sp.clientId ?? null;
  const title = students ? 'Students' : (listing?.breadcrumb.at(-1)?.name ?? 'Documents');
  const href = (p: Record<string, string | undefined>) => `${basePath}${qs(p)}`;
  const activeView = students ? null : (sp.view ?? (!sp.folderId && !sp.clientId && !sp.area ? 'all' : null));

  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          students
            ? 'Every student you work with: how many documents, what is waiting, how complete.'
            : folder
              ? `${folder.documentCount} ${folder.documentCount === 1 ? 'file' : 'files'}${folder.restricted ? ' · restricted' : ''}`
              : 'Every document in one place - like a drive, with review built in.'
        }
        breadcrumb={
          listing && listing.breadcrumb.length > 1
            ? listing.breadcrumb.slice(0, -1).map((c) => ({
                label: c.name,
                href:
                  c.kind === 'root'
                    ? basePath
                    : c.kind === 'students'
                      ? href({ area: 'students' })
                      : c.kind === 'student'
                        ? href({ clientId: c.clientId ?? undefined })
                        : c.kind === 'agency'
                          ? href({ area: 'agency' })
                          : href({ folderId: c.id ?? undefined }),
              }))
            : undefined
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="Drive" className="lg:sticky lg:top-20">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {VIEWS.map((v) => (
              <li key={v.key}>
                <SideLink href={href({ view: v.key })} active={activeView === v.key} icon={<v.icon size={16} />}>
                  {v.label}
                </SideLink>
              </li>
            ))}
            <li className="hidden px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-400 lg:block">Folders</li>
            <li>
              <SideLink href={href({ area: 'students' })} active={students || Boolean(studentId)} icon={<IconUsers size={16} />}>
                Students
              </SideLink>
            </li>
            <li>
              <SideLink href={href({ area: 'agency' })} active={sp.area === 'agency' || Boolean(folder && !folder.clientId)} icon={<IconBuilding size={16} />}>
                Agency files
              </SideLink>
            </li>
            {can(user, 'document.settings') && (
              <li>
                <SideLink href={`${basePath}/settings`} active={false} icon={<IconKey size={16} />}>
                  Settings
                </SideLink>
              </li>
            )}
          </ul>
        </nav>

        <div className="min-w-0">
          {students && studentList ? (
            <StudentsTable data={studentList} basePath={basePath} q={sp.q} />
          ) : listing ? (
            <>
              <DriveActions
                folderParent={folder ? { parentId: folder.id, clientId: folder.clientId } : sp.clientId ? { clientId: sp.clientId } : sp.area === 'agency' ? { clientId: null } : null}
                uploadTarget={folder ? { folderId: folder.id } : sp.clientId ? { clientId: sp.clientId } : null}
                canManage={abilities.manage && sp.view !== 'trash'}
                canUpload={can(user, 'document.upload') && sp.view !== 'trash'}
                manager={abilities.manager}
                types={types}
                settings={settings}
              />
              <DriveToolbar types={types} staff />
              <div className={cx('grid items-start gap-5', checklist && 'xl:grid-cols-[minmax(0,1fr)_340px]')}>
                <div className="min-w-0">
                  {listing.folders.length === 0 && listing.documents.length === 0 ? (
                    <Card>
                      <EmptyState
                        title={sp.view === 'trash' ? 'The trash is empty' : sp.q || sp.type || sp.status ? 'Nothing matches' : 'Nothing here yet'}
                        description={
                          sp.view === 'trash'
                            ? `Removed files stay here for ${settings.retentionDays} days, then go for good.`
                            : sp.q || sp.type || sp.status
                              ? 'Try fewer filters, or search for something else.'
                              : 'Upload files, or drag them onto the upload area.'
                        }
                      />
                    </Card>
                  ) : (
                    <DriveItems
                      folders={listing.folders}
                      documents={listing.documents}
                      layout={layout}
                      basePath={basePath}
                      abilities={abilities}
                      trashView={sp.view === 'trash'}
                      openId={sp.open ?? null}
                    />
                  )}
                  <Pagination data={{ ...listing, items: listing.documents }} buildHref={(p) => href({ ...query, layout: sp.layout, page: String(p) })} />
                </div>
                {checklist && (
                  <aside aria-label="Checklist">
                    <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-400">Checklist</h2>
                    <ChecklistPanel checklist={checklist} audience="staff" documentHref={(id) => href({ clientId: sp.clientId, view: 'all', open: id })} />
                  </aside>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function SideLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex h-9 items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-[13.5px] font-medium',
        active ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-950',
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

function StudentsTable({ data, basePath, q }: { data: Paginated<DriveStudentView>; basePath: string; q?: string }) {
  return (
    <>
      <form action={basePath} className="mb-4 flex gap-2">
        <input type="hidden" name="area" value="students" />
        <input name="q" defaultValue={q} placeholder="Find a student" aria-label="Find a student" className="h-9 w-full max-w-sm rounded-lg border border-line-strong bg-paper px-3 text-[13.5px]" />
      </form>
      {data.items.length === 0 ? (
        <Card>
          <EmptyState title="No students" description="Students you work with appear here, each with their own folders." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {data.items.map((s) => (
              <li key={s.clientId}>
                <Link href={`${basePath}?clientId=${s.clientId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50">
                  <IconFolder size={22} className="shrink-0 text-info-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink-900">{s.name}</span>
                    <span className="block truncate text-[12px] text-ink-500">
                      {s.documentCount} {s.documentCount === 1 ? 'file' : 'files'}{s.pendingCount ? ` · ${s.pendingCount} to review` : ''}
                      {s.consultantName ? ` · ${s.consultantName}` : ''}
                      {s.lastUploadAt ? ` · last upload ${formatDate(s.lastUploadAt)}` : ''}
                    </span>
                  </span>
                  {s.completion !== null && (
                    <span className="hidden w-32 shrink-0 sm:block">
                      <span className="flex justify-between text-[11.5px] text-ink-500">
                        <span>Checklist</span>
                        <span className="tnum font-medium text-ink-800">{s.completion}%</span>
                      </span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <span className={cx('block h-full origin-left rounded-full', s.completion === 100 ? 'bg-ok-500' : 'bg-brand-500')} style={{ transform: `scaleX(${s.completion / 100})` }} />
                      </span>
                    </span>
                  )}
                  <IconChevronRight size={16} className="shrink-0 text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Pagination data={data} buildHref={(p) => `${basePath}?area=students${q ? `&q=${encodeURIComponent(q)}` : ''}&page=${p}`} />
    </>
  );
}
