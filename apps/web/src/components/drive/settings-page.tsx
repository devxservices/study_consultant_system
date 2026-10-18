import Link from 'next/link';
import type {
  AuthUser,
  DocumentTypeView,
  DriveSettingsView,
  FolderTemplateView,
  GrantView,
  RequirementSetView,
  ShareLinkView,
} from '@crm/shared';
import { apiFetch } from '@/lib/api';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/format';
import { Card, EmptyState, PageHeader, Pill, cx } from '../ui';
import { ActionButton } from '../forms';
import { NoAccess } from '../no-access';
import { ChecklistsEditor, DocumentTypesEditor, DriveSettingsForm, FolderTemplatesEditor } from './settings-editors';

const TABS = [
  { key: 'general', label: 'Uploads and housekeeping' },
  { key: 'types', label: 'Document types' },
  { key: 'templates', label: 'Folder templates' },
  { key: 'checklists', label: 'Checklists' },
  { key: 'links', label: 'Share links' },
  { key: 'access', label: 'Access grants' },
] as const;

/** How the consultancy's documents work: rules, types, folders, checklists, sharing and access. */
export async function DriveSettingsPage({ user, basePath, tab: raw }: { user: AuthUser; basePath: string; tab?: string }) {
  if (!can(user, 'document.settings')) return <NoAccess title="Document settings" permission="document.settings" />;
  const tab = TABS.some((t) => t.key === raw) ? raw! : 'general';
  const manager = user.role === 'manager';

  const [settings, types, templates, sets, links, grants] = await Promise.all([
    tab === 'general' ? apiFetch<DriveSettingsView>('/drive/settings') : Promise.resolve(null),
    tab === 'types' || tab === 'checklists' ? apiFetch<DocumentTypeView[]>('/drive/types') : Promise.resolve(null),
    tab === 'templates' ? apiFetch<FolderTemplateView[]>('/drive/folder-templates') : Promise.resolve(null),
    tab === 'checklists' ? apiFetch<RequirementSetView[]>('/drive/checklists') : Promise.resolve(null),
    tab === 'links' ? apiFetch<ShareLinkView[]>('/drive/shares') : Promise.resolve(null),
    tab === 'access' && manager ? apiFetch<GrantView[]>('/drive/grants') : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Document settings"
        subtitle="What students may upload, how documents are organised and named, which checklists apply, and who can see what."
        breadcrumb={[{ href: basePath, label: 'Documents' }, { label: 'Settings' }]}
      />
      <nav className="-mb-px mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Settings">
        {TABS.filter((t) => t.key !== 'access' || manager).map((t) => (
          <Link
            key={t.key}
            href={`${basePath}/settings${t.key === 'general' ? '' : `?tab=${t.key}`}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cx(
              'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] font-medium',
              tab === t.key ? 'border-brand-600 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-800',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {settings && <DriveSettingsForm initial={settings} />}
      {tab === 'types' && types && <DocumentTypesEditor types={types} />}
      {templates && <FolderTemplatesEditor templates={templates} />}
      {sets && types && <ChecklistsEditor sets={sets} types={types} />}
      {links && <LinksTable links={links} />}
      {tab === 'access' && grants && <GrantsTable grants={grants} />}
    </>
  );
}

function LinksTable({ links }: { links: ShareLinkView[] }) {
  if (links.length === 0) {
    return (
      <Card>
        <EmptyState title="No share links yet" description="Share a document or folder from the drive to send a university a secure, expiring link." />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {links.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium text-ink-900">
                {l.label}
                <Pill tone={l.active ? 'ok' : 'neutral'}>{l.active ? 'Active' : l.revokedAt ? 'Switched off' : 'Expired'}</Pill>
                {l.hasPassword && <Pill tone="neutral">Password</Pill>}
                {l.viewOnly && <Pill tone="neutral">View only</Pill>}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-ink-500">
                {l.targetName}
                {l.clientName ? ` · ${l.clientName}` : ''} · by {l.createdByName ?? '-'} on {formatDate(l.createdAt)} · expires {formatDate(l.expiresAt)} · opened{' '}
                {l.views} {l.views === 1 ? 'time' : 'times'}
                {l.lastAccessAt ? `, last ${formatDate(l.lastAccessAt)}` : ''}
              </p>
            </div>
            {l.active && (
              <ActionButton url={`/api/drive/shares/${l.id}/revoke`} variant="ghost" confirm={`Switch off the link for ${l.label}?`}>
                Switch off
              </ActionButton>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GrantsTable({ grants }: { grants: GrantView[] }) {
  if (grants.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No extra access granted"
          description="Everyone sees the students they work with. To open a restricted folder - or one student’s folder - to someone else, use a folder’s access settings in the drive."
        />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {grants.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-ink-900">
                {g.userName} can {g.access === 'edit' ? 'see and add to' : 'see'} {g.resourceType === 'folder' ? 'the folder' : ''} “{g.resourceName}”
              </p>
              <p className="text-[12px] text-ink-500">Since {formatDate(g.createdAt)}</p>
            </div>
            <ActionButton url={`/api/drive/grants/${g.id}`} method="DELETE" variant="ghost">
              Remove
            </ActionButton>
          </li>
        ))}
      </ul>
    </Card>
  );
}
